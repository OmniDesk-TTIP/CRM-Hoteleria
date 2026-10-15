import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { SatisfactionSurveyStatus } from '../../infrastructure/database/entities/SatisfactionSurvey.entity';
import { ChatService } from '../chat/chat.service';
import {
  addDays,
  zonedDateKey,
  zonedStartOfDay,
} from '../../common/date.util';
import { percentage } from '../../common/number.util';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { zonedNow } from '../supportHours/supportHours.util';
import {
  buildInvitationMessage,
  hashSurveyToken,
  SatisfactionSurveyModel,
  SurveyAnswer,
  surveyCheckOutWindow,
} from './satisfactionSurvey.model';
import {
  InvitableReservation,
  SatisfactionSurveyRepository,
  SurveyPeriod,
} from './satisfactionSurvey.repository';
import { SubmitSurveyDto } from './dto/submitSurvey.dto';
import { PublicSurveyDto } from './dto/publicSurvey.dto';
import {
  ListPublicReviewsQueryDto,
  PaginatedPublicReviewsDto,
  PublicReviewDto,
  PublicReviewsSummaryDto,
} from './dto/publicReview.dto';
import {
  ListSurveysQueryDto,
  SurveyPeriodQueryDto,
} from './dto/listSurveys.dto';
import {
  PaginatedSurveyResponsesDto,
  SurveyResponseDto,
  SurveySummaryDto,
} from './dto/surveyResponse.dto';

/** Invitaciones por corrida del cron: las que sobren salen en la siguiente. */
const INVITATIONS_PER_RUN = 50;

/** Un token generado tiene 43 caracteres; lo que sea mucho más largo no es un token. */
const MAX_TOKEN_LENGTH = 128;

/** Lo que queda en el chat del panel: sin el link, que es la credencial del huésped. */
const INVITATION_CHAT_NOTICE =
  '📋 Se le envió al huésped la encuesta de satisfacción post-estadía.';

@Injectable()
export class SatisfactionSurveyService {
  private readonly logger = new Logger(SatisfactionSurveyService.name);

  constructor(
    private readonly surveyRepository: SatisfactionSurveyRepository,
    private readonly supportHoursService: SupportHoursService,
    private readonly chatService: ChatService,
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleInvitationsCron(): Promise<void> {
    await this.sendInvitations(new Date());
  }

  /**
   * CA1: invita por Chamber a los huéspedes cuya estadía terminó. Cada reserva recibe la
   * invitación una sola vez: la encuesta se guarda antes de mandar el mensaje y no se reintenta
   * si Telegram falla. Devuelve cuántas invitaciones salieron.
   */
  async sendInvitations(now: Date): Promise<number> {
    const landingBaseUrl = this.configService.get<string>('LANDING_BASE_URL');
    if (!landingBaseUrl) {
      this.logger.warn(
        'LANDING_BASE_URL no está configurada: no se mandan encuestas de satisfacción',
      );
      return 0;
    }

    const timeZone = this.supportHoursService.getTimeZone();
    const window = surveyCheckOutWindow(
      zonedDateKey(now, timeZone),
      zonedNow(now, timeZone).minutes,
    );
    const reservations = await this.surveyRepository.findReservationsToInvite(
      window.from,
      window.to,
      INVITATIONS_PER_RUN,
    );

    let sent = 0;
    for (const reservation of reservations) {
      if (await this.invite(reservation, landingBaseUrl, now)) sent += 1;
    }

    if (sent > 0) {
      this.logger.log(`Enviadas ${sent} encuesta(s) de satisfacción`);
    }
    return sent;
  }

  private async invite(
    reservation: InvitableReservation,
    landingBaseUrl: string,
    now: Date,
  ): Promise<boolean> {
    const { survey, token, tokenHash } =
      SatisfactionSurveyModel.createInvitation({
        reservationId: reservation.reservationId,
        telegramUserId: reservation.telegramUserId,
        now,
      });

    const created = await this.surveyRepository.createInvitation(
      survey,
      tokenHash,
    );
    if (!created) return false;

    const link = `${landingBaseUrl.replace(/\/+$/, '')}/encuesta/${token}`;
    try {
      await this.bot.telegram.sendMessage(
        reservation.telegramUserId,
        buildInvitationMessage(reservation.guestFullName, link),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo mandar la encuesta de la reserva ${reservation.reservationId} a ${reservation.telegramUserId}: ${error}`,
      );
      await this.surveyRepository.markSendFailed(survey.id);
      return false;
    }

    await this.surveyRepository.markSent(survey.id, now);
    await this.recordInChat(reservation.telegramUserId);
    return true;
  }

  /** Deja constancia en el chat del panel. Si falla, la invitación ya salió igual. */
  private async recordInChat(telegramUserId: string): Promise<void> {
    try {
      const session = await this.chatService.getOrCreateSession(telegramUserId);
      await this.chatService.recordSystemMessage(
        session,
        INVITATION_CHAT_NOTICE,
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar la encuesta en el chat de ${telegramUserId}: ${error}`,
      );
    }
  }

  // ───────── Huésped (web pública) ─────────

  async getForGuest(token: string, now: Date): Promise<PublicSurveyDto> {
    const survey = await this.findByToken(token);
    return PublicSurveyDto.fromModel(survey, now);
  }

  /** CA2/CA3/CA4: guarda la respuesta del huésped, una sola vez y mientras el link esté vigente. */
  async submit(
    token: string,
    dto: SubmitSurveyDto,
    now: Date,
  ): Promise<PublicSurveyDto> {
    const survey = await this.findByToken(token);
    this.assertOpen(survey, now);

    const answer: SurveyAnswer = {
      overallRating: dto.overallRating,
      cleanlinessRating: dto.cleanlinessRating,
      attentionRating: dto.attentionRating,
      servicesRating: dto.servicesRating,
      comment: dto.comment ? dto.comment : null,
      publishConsent: dto.publishConsent ?? false,
    };

    const saved = await this.surveyRepository.answerIfOpen(
      survey.id,
      answer,
      now,
    );
    if (!saved) {
      // Otro envío ganó la carrera (o venció justo ahora): se informa el estado real.
      const current = await this.surveyRepository.findById(survey.id);
      this.assertOpen(current ?? survey, now);
      throw new ConflictException('Ya respondiste esta encuesta');
    }

    survey.status = SatisfactionSurveyStatus.ANSWERED;
    survey.answeredAt = now;
    survey.answer = answer;
    return PublicSurveyDto.fromModel(survey, now);
  }

  private async findByToken(token: string): Promise<SatisfactionSurveyModel> {
    const survey =
      token && token.length <= MAX_TOKEN_LENGTH
        ? await this.surveyRepository.findByTokenHash(hashSurveyToken(token))
        : null;
    if (!survey) throw new NotFoundException('La encuesta no existe');
    return survey;
  }

  private assertOpen(survey: SatisfactionSurveyModel, now: Date): void {
    const state = survey.getPublicState(now);
    if (state === 'ANSWERED') {
      throw new ConflictException('Ya respondiste esta encuesta');
    }
    if (state === 'EXPIRED') {
      throw new GoneException('El link de la encuesta venció');
    }
  }

  // ───────── Reseñas en la web del hotel ─────────

  async listPublicReviews(
    query: ListPublicReviewsQueryDto,
  ): Promise<PaginatedPublicReviewsDto> {
    const { items, total } = await this.surveyRepository.findPublishedPaginated(
      query.page,
      query.pageSize,
    );

    return {
      items: items.map((model) => PublicReviewDto.fromModel(model)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getPublicReviewsSummary(): Promise<PublicReviewsSummaryDto> {
    const { overall, responses } = await this.surveyRepository.averages({
      from: null,
      to: null,
    });
    return { averageRating: overall, ratingsCount: responses };
  }

  // ───────── Panel (solo Administradores) ─────────

  async list(query: ListSurveysQueryDto): Promise<PaginatedSurveyResponsesDto> {
    const { items, total } = await this.surveyRepository.findAnsweredPaginated(
      this.toPeriod(query),
      query.page,
      query.pageSize,
    );

    return {
      items: items.map((model) => SurveyResponseDto.fromModel(model)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** CA5: promedio de cada calificación y tasa de respuesta del período. */
  async getSummary(query: SurveyPeriodQueryDto): Promise<SurveySummaryDto> {
    const period = this.toPeriod(query);
    const [averages, invitations] = await Promise.all([
      this.surveyRepository.averages(period),
      this.surveyRepository.invitationCounts(period),
    ]);

    return {
      from: query.from ?? null,
      to: query.to ?? null,
      responses: averages.responses,
      averages: {
        overall: averages.overall,
        cleanliness: averages.cleanliness,
        attention: averages.attention,
        services: averages.services,
      },
      invitations: {
        sent: invitations.sent,
        answered: invitations.answered,
        responseRatePct: percentage(invitations.answered, invitations.sent),
      },
    };
  }

  /** Publica o despublica la reseña en la web del hotel. Es siempre una decisión manual del admin. */
  async setPublication(
    id: string,
    published: boolean,
    now: Date,
  ): Promise<SurveyResponseDto> {
    const survey = await this.surveyRepository.findById(id);
    if (!survey) throw new NotFoundException('Encuesta no encontrada');

    const error = survey.setPublished(published, now);
    if (error) throw new BadRequestException(error);

    await this.surveyRepository.updatePublication(survey);
    return SurveyResponseDto.fromModel(survey);
  }

  /**
   * Convierte los días del filtro (calendario del hotel, ambos incluidos) a instantes UTC:
   * `from` arranca a las 00:00 de ese día y `to` corta a las 00:00 del día siguiente.
   */
  private toPeriod(query: SurveyPeriodQueryDto): SurveyPeriod {
    const { from, to } = query;
    for (const day of [from, to]) {
      if (day && addDays(day, 0) !== day) {
        throw new BadRequestException(`La fecha ${day} no existe`);
      }
    }
    if (from && to && from > to) {
      throw new BadRequestException(
        'La fecha de inicio no puede ser posterior a la de fin',
      );
    }

    const timeZone = this.supportHoursService.getTimeZone();
    return {
      from: from ? zonedStartOfDay(from, timeZone) : null,
      to: to ? zonedStartOfDay(addDays(to, 1), timeZone) : null,
    };
  }
}
