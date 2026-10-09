import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { SpaReservationStatus } from '../../infrastructure/database/entities/SpaReservation.entity';
import { formatDate, parseDate } from '../bookingProcess/date.util';
import { ChatService } from '../chat/chat.service';
import { SpaService } from '../spa/spa.service';
import { escapeHtml } from '../telegram/telegram.format';
import { describeWeekdays, toCalendarDayString } from '../spa/model/spa.model';
import { SpaReservationModel } from './spaReservation.model';
import { RequestSpaBookingDto } from './dto/requestSpaBooking.dto';
import { ListSpaReservationsQueryDto } from './dto/listSpaReservations.dto';
import {
  PaginatedSpaReservationsDto,
  SpaReservationDto,
} from './dto/spaReservation.dto';
import { SpaReservationRepository } from './spaReservation.repository';

export type RequestSpaResult =
  | { ok: true; request: SpaReservationModel; reply: string }
  | { ok: false; reason: string };

@Injectable()
export class SpaReservationService {
  private readonly logger = new Logger(SpaReservationService.name);

  constructor(
    private readonly spaReservationRepository: SpaReservationRepository,
    private readonly spaService: SpaService,
    private readonly chatService: ChatService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  async requestSpa(
    telegramUserId: string,
    dto: RequestSpaBookingDto,
    now: Date = new Date(),
  ): Promise<RequestSpaResult> {
    const eligible = await this.spaService.findEligibleStay(
      telegramUserId,
      now,
    );
    if (!eligible) {
      return {
        ok: false,
        reason:
          'Los turnos de spa son para huéspedes con una reserva confirmada.',
      };
    }

    const spaService = await this.spaService.findById(dto.serviceId);
    if (!spaService || !spaService.canBeRequested()) {
      return {
        ok: false,
        reason: 'Ese servicio de spa ya no está disponible.',
      };
    }

    const requestedDay = parseDate(dto.date);
    const requestedDate = toCalendarDayString(requestedDay);

    const dateError = SpaReservationModel.getDateError(
      requestedDate,
      eligible.today,
      eligible.stay,
    );
    if (dateError) return { ok: false, reason: dateError };

    if (!spaService.isAvailableAt(requestedDay.getDay(), dto.time)) {
      return {
        ok: false,
        reason: `${spaService.name} se brinda ${describeWeekdays(spaService.availableWeekdays)} de ${spaService.opensAt} a ${spaService.closesAt} y dura ${spaService.durationMinutes} minutos, así que no puedo tomarlo el ${dto.date} a las ${dto.time}.`,
      };
    }

    const duplicated = await this.spaReservationRepository.existsPendingSlot(
      telegramUserId,
      spaService.id,
      requestedDate,
      dto.time,
    );
    if (duplicated) {
      return {
        ok: false,
        reason:
          'Ya tengo registrada una solicitud tuya para ese servicio, día y hora. Recepción te la va a confirmar.',
      };
    }

    const request = SpaReservationModel.create({
      telegramUserId,
      roomReservationId: eligible.reservationId,
      spaServiceId: spaService.id,
      serviceName: spaService.name,
      guestFullName: eligible.guestFullName,
      requestedDate,
      requestedTime: dto.time,
    });
    await this.spaReservationRepository.insert(request);

    return {
      ok: true,
      request,
      reply: `Listo, registré tu solicitud de ${escapeHtml(spaService.name)} para el ${formatDate(requestedDay)} a las ${dto.time}. Recepción te va a confirmar el turno.`,
    };
  }

  async list(
    query: ListSpaReservationsQueryDto,
  ): Promise<PaginatedSpaReservationsDto> {
    const { items, total } =
      await this.spaReservationRepository.findManyPaginated(query);

    return {
      items: items.map((model) => SpaReservationDto.fromModel(model)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async changeStatus(
    id: string,
    status: SpaReservationStatus,
  ): Promise<SpaReservationDto> {
    const request = await this.spaReservationRepository.findById(id);
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    const error = request.changeStatus(status);
    if (error) throw new BadRequestException(error);

    await this.spaReservationRepository.updateStatus(request);
    await this.notifyGuest(request);
    return SpaReservationDto.fromModel(request);
  }

  /**
   * Avisa al huésped por Telegram que recepción resolvió su turno y deja el aviso en el chat,
   * igual que el aviso de pago. Un problema de mensajería (el huésped bloqueó al bot, Telegram
   * caído) no puede impedir que recepción resuelva el turno: el estado ya quedó guardado.
   */
  private async notifyGuest(request: SpaReservationModel): Promise<void> {
    const notice = request.getStatusNotice();
    if (!notice) return;

    try {
      await this.bot.telegram.sendMessage(request.telegramUserId, notice);
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar el turno ${request.id} a ${request.telegramUserId}: ${error}`,
      );
      return;
    }

    try {
      const session = await this.chatService.getOrCreateSession(
        request.telegramUserId,
      );
      await this.chatService.recordSystemMessage(session, notice);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el aviso del turno ${request.id} en el chat de ${request.telegramUserId}: ${error}`,
      );
    }
  }
}
