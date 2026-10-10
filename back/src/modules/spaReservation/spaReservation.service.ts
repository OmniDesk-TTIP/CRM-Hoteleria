import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import {
  SpaReservationClientType,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';
import { formatDate, parseDate } from '../bookingProcess/date.util';
import { ChatService } from '../chat/chat.service';
import {
  PaymentService,
  RESERVATION_HOLD_MINUTES,
} from '../payment/payment.service';
import { SpaService } from '../spa/spa.service';
import { escapeHtml, htmlLink } from '../telegram/telegram.format';
import { describeWeekdays, toCalendarDayString } from '../spa/model/spa.model';
import { SpaReservationModel } from './spaReservation.model';
import { RequestSpaBookingDto } from './dto/requestSpaBooking.dto';
import { ListSpaReservationsQueryDto } from './dto/listSpaReservations.dto';
import {
  PaginatedSpaReservationsDto,
  SpaReservationDto,
} from './dto/spaReservation.dto';
import { SpaReservationRepository } from './spaReservation.repository';

/**
 * Resultado de pedir un turno desde el chat. Los rechazos no son excepciones: son respuestas
 * esperables y `reason` ya está redactado para mostrárselo al cliente.
 */
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
    private readonly paymentService: PaymentService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  /**
   * CA4: pedir un turno de spa. Cualquiera puede pedirlo: el huésped (reserva confirmada) no paga
   * y su turno espera a recepción; el cliente externo paga por Mercado Pago y su turno se
   * confirma solo al acreditarse el pago. Ambos ocupan un lugar de la capacidad del servicio.
   */
  async requestSpa(
    telegramUserId: string,
    dto: RequestSpaBookingDto,
    now: Date = new Date(),
  ): Promise<RequestSpaResult> {
    const spa = await this.spaService.findById(dto.serviceId);
    if (!spa || !spa.canBeRequested()) {
      return {
        ok: false,
        reason: 'Ese servicio de spa ya no está disponible.',
      };
    }

    const eligible = await this.spaService.findEligibleStay(
      telegramUserId,
      now,
    );

    // Mercado Pago necesita nombre y DNI del que paga; el huésped ya los tiene cargados.
    if (!eligible && (!dto.fullName || !dto.dni)) {
      return {
        ok: false,
        reason:
          'Para reservarte el turno necesito tu nombre completo y tu DNI (solo números).',
      };
    }

    const requestedDay = parseDate(dto.date);
    const requestedDate = toCalendarDayString(requestedDay);
    const clock = this.spaService.getHotelClock(now);

    const dateError = SpaReservationModel.getDateError({
      requestedDate,
      requestedTime: dto.time,
      today: clock.today,
      nowMinutes: clock.minutes,
      stay: eligible?.stay ?? null,
    });
    if (dateError) return { ok: false, reason: dateError };

    if (!spa.isAvailableAt(requestedDay.getDay(), dto.time)) {
      return {
        ok: false,
        reason: `${spa.name} se brinda ${describeWeekdays(spa.availableWeekdays)} de ${spa.opensAt} a ${spa.closesAt} y dura ${spa.durationMinutes} minutos, así que no puedo tomarlo el ${dto.date} a las ${dto.time}.`,
      };
    }

    const duplicated = await this.spaReservationRepository.existsPendingSlot(
      telegramUserId,
      spa.id,
      requestedDate,
      dto.time,
    );
    if (duplicated) {
      return {
        ok: false,
        reason:
          'Ya tengo registrada una solicitud tuya para ese servicio, día y hora.',
      };
    }

    const isGuest = eligible !== null;
    const request = SpaReservationModel.create({
      clientType: isGuest
        ? SpaReservationClientType.GUEST
        : SpaReservationClientType.EXTERNAL,
      telegramUserId,
      roomReservationId: eligible?.reservationId ?? null,
      spaServiceId: spa.id,
      serviceName: spa.name,
      guestFullName: eligible?.guestFullName ?? dto.fullName ?? '',
      guestDni: isGuest ? null : (dto.dni ?? null),
      requestedDate,
      requestedTime: dto.time,
      amount: isGuest ? 0 : spa.price,
    });

    const saved = await this.spaReservationRepository.insertIfCapacity(
      request,
      spa,
    );
    if (!saved) {
      return {
        ok: false,
        reason: `Ya no quedan lugares para ${spa.name} el ${dto.date} a las ${dto.time}. ¿Probamos con otro horario?`,
      };
    }

    const when = `el ${formatDate(requestedDay)} a las ${dto.time}`;
    if (isGuest) {
      return {
        ok: true,
        request,
        reply: `Listo, registré tu solicitud de ${escapeHtml(spa.name)} para ${when}. Recepción te va a confirmar el turno.`,
      };
    }
    return this.startPayment(request, when);
  }

  /** Genera el link de Mercado Pago de un turno externo y arma la respuesta con el link. */
  private async startPayment(
    request: SpaReservationModel,
    when: string,
  ): Promise<RequestSpaResult> {
    try {
      const { preferenceId, initPoint } =
        await this.paymentService.createSpaPreference({
          id: request.id,
          serviceName: request.serviceName,
          amount: request.amount,
          fullName: request.guestFullName,
          dni: request.guestDni ?? '',
        });
      await this.spaReservationRepository.attachPreference(
        request.id,
        preferenceId,
        initPoint,
      );

      const reply = [
        `Te estoy guardando el turno de ${escapeHtml(request.serviceName)} ${when}, a nombre de ${escapeHtml(request.guestFullName)}.`,
        '',
        `Total: $${request.amount}`,
        '',
        `⏳ <b>Todavía no está confirmado.</b> Te guardo el lugar ${RESERVATION_HOLD_MINUTES} minutos; si en ese rato no se acredita el pago, se libera para otra persona.`,
        '',
        '👉 Pagá acá:',
        htmlLink(initPoint, initPoint),
        '',
        'Apenas se acredite el pago te escribo por acá y ahí queda confirmado.',
      ].join('\n');

      return { ok: true, request, reply };
    } catch (error) {
      this.logger.error(
        `No se pudo crear el link de pago del turno ${request.id}: ${error}`,
      );
      // Sin link no hay forma de pagar: se libera el lugar enseguida en vez de dejarlo retenido.
      request.expirePayment();
      await this.spaReservationRepository.updateStatus(request);
      return {
        ok: false,
        reason:
          'No pude generar el link de pago. Probá de nuevo en unos minutos.',
      };
    }
  }

  /**
   * Procesa un pago de Mercado Pago de un turno de spa (webhook o redirect de vuelta). Si está
   * aprobado confirma el turno y avisa al cliente. Es idempotente: el webhook y el redirect
   * suelen llegar casi juntos y el aviso sale una sola vez.
   */
  async confirmPayment(paymentId: string, source: string): Promise<void> {
    const payment = await this.paymentService.getPayment(paymentId);

    if (!payment?.id || !payment.external_reference) {
      this.logger.warn(
        `[${source}] Pago ${paymentId} sin external_reference; se ignora`,
      );
      return;
    }
    if (payment.status !== 'approved') {
      this.logger.log(
        `[${source}] Pago ${payment.id} en estado "${payment.status}"; no se confirma`,
      );
      return;
    }

    const request = await this.spaReservationRepository.findById(
      payment.external_reference,
    );
    if (!request) {
      this.logger.warn(
        `[${source}] Turno de spa no encontrado: external_reference=${payment.external_reference}`,
      );
      return;
    }

    const error = request.confirmPayment();
    if (error) {
      if (request.status === SpaReservationStatus.CANCELLED) {
        // El pago entró después de que el lugar se liberó: no se confirma solo porque el
        // lugar puede estar ocupado por otro cliente. Hay que reembolsarlo a mano.
        this.logger.warn(
          `[${source}] Pago ${payment.id} acreditado para el turno vencido ${request.id}: hay que reembolsarlo`,
        );
      } else {
        this.logger.log(
          `[${source}] Turno ${request.id} ya estaba resuelto; no se vuelve a notificar`,
        );
      }
      return;
    }

    const confirmed =
      await this.spaReservationRepository.confirmIfPendingPayment(
        request.id,
        String(payment.id),
      );
    if (!confirmed) return;

    await this.notifyGuest(request);
    this.logger.log(
      `[${source}] Turno ${request.id} confirmado con el pago ${payment.id}`,
    );
  }

  /** Libera los lugares de los turnos externos que no se pagaron a tiempo. */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async releaseUnpaid(): Promise<void> {
    const cutoff = new Date(Date.now() - RESERVATION_HOLD_MINUTES * 60 * 1000);
    const released =
      await this.spaReservationRepository.cancelUnpaidBefore(cutoff);

    if (released > 0) {
      this.logger.log(
        `Cancelados ${released} turno(s) de spa vencidos por falta de pago`,
      );
    }
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
   * Avisa al cliente por Telegram que su turno quedó resuelto y deja el aviso en el chat, igual
   * que el aviso de pago de las habitaciones. Un problema de mensajería (el cliente bloqueó al
   * bot, Telegram caído) no puede impedir que el turno se resuelva: el estado ya quedó guardado.
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
