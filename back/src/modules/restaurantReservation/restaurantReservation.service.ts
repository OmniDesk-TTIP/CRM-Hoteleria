import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { RestaurantReservationStatus } from '../../infrastructure/database/entities/RestaurantReservation.entity';
import { formatDate, parseDate } from '../bookingProcess/date.util';
import { ChatService } from '../chat/chat.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { describeSchedule } from '../restaurant/model/restaurant.model';
import { SpaService } from '../spa/spa.service';
import { toCalendarDayString } from '../spa/model/spa.model';
import { escapeHtml } from '../telegram/telegram.format';
import { RestaurantReservationModel } from './restaurantReservation.model';
import { RestaurantReservationRepository } from './restaurantReservation.repository';
import {
  ListRestaurantReservationsQueryDto,
  PaginatedRestaurantReservationsDto,
  RequestTableBookingDto,
  RestaurantReservationDto,
} from './dto/restaurantReservation.dto';

export type RequestTableResult =
  | { ok: true; request: RestaurantReservationModel; reply: string }
  | { ok: false; reason: string };

@Injectable()
export class RestaurantReservationService {
  private readonly logger = new Logger(RestaurantReservationService.name);

  constructor(
    private readonly restaurantReservationRepository: RestaurantReservationRepository,
    private readonly restaurantService: RestaurantService,
    private readonly spaService: SpaService,
    private readonly chatService: ChatService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  async requestTable(
    telegramUserId: string,
    dto: RequestTableBookingDto,
    now: Date = new Date(),
  ): Promise<RequestTableResult> {
    const { settings } = await this.restaurantService.getSettings();
    if (!settings.isActive()) {
      return {
        ok: false,
        reason: 'El restaurante no está tomando reservas por el momento.',
      };
    }

    const eligible = await this.spaService.findEligibleStay(
      telegramUserId,
      now,
    );
    if (!eligible) {
      return {
        ok: false,
        reason:
          'El restaurante es exclusivo para huéspedes con una reserva confirmada en el hotel.',
      };
    }

    if (dto.partySize > settings.maxPartySize) {
      return {
        ok: false,
        reason: `Por el chat puedo pedir mesas de hasta ${settings.maxPartySize} personas. Para grupos más grandes, consultalo con recepción.`,
      };
    }

    const requestedDay = parseDate(dto.date);
    const requestedDate = toCalendarDayString(requestedDay);
    const clock = this.spaService.getHotelClock(now);

    const dateError = RestaurantReservationModel.getDateError({
      requestedDate,
      requestedTime: dto.time,
      today: clock.today,
      nowMinutes: clock.minutes,
      stay: eligible.stay,
    });
    if (dateError) return { ok: false, reason: dateError };

    if (!settings.isOpenAt(requestedDay.getDay(), dto.time)) {
      return {
        ok: false,
        reason: `El restaurante atiende ${describeSchedule(settings)}, así que no puedo pedir mesa el ${dto.date} a las ${dto.time}.`,
      };
    }

    const duplicated =
      await this.restaurantReservationRepository.existsPendingSlot(
        telegramUserId,
        requestedDate,
        dto.time,
      );
    if (duplicated) {
      return {
        ok: false,
        reason:
          'Ya tengo registrado un pedido de mesa tuyo para ese día y hora.',
      };
    }

    const request = RestaurantReservationModel.create({
      telegramUserId,
      roomReservationId: eligible.reservationId,
      guestFullName: eligible.guestFullName,
      requestedDate,
      requestedTime: dto.time,
      partySize: dto.partySize,
      notes: dto.notes?.trim() || null,
    });
    await this.restaurantReservationRepository.insert(request);

    const people =
      dto.partySize === 1 ? '1 persona' : `${dto.partySize} personas`;
    return {
      ok: true,
      request,
      reply: `Listo, registré tu pedido de mesa para ${people} el ${formatDate(requestedDay)} a las ${escapeHtml(dto.time)}. Recepción te va a confirmar la reserva.`,
    };
  }

  async list(
    query: ListRestaurantReservationsQueryDto,
  ): Promise<PaginatedRestaurantReservationsDto> {
    const { items, total } =
      await this.restaurantReservationRepository.findManyPaginated(query);

    return {
      items: items.map((model) => RestaurantReservationDto.fromModel(model)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async changeStatus(
    id: string,
    status: RestaurantReservationStatus,
  ): Promise<RestaurantReservationDto> {
    const request = await this.restaurantReservationRepository.findById(id);
    if (!request) throw new NotFoundException('Solicitud no encontrada');

    const error = request.changeStatus(status);
    if (error) throw new BadRequestException(error);

    await this.restaurantReservationRepository.updateStatus(request);
    await this.notifyGuest(request);
    return RestaurantReservationDto.fromModel(request);
  }

  private async notifyGuest(
    request: RestaurantReservationModel,
  ): Promise<void> {
    const notice = request.getStatusNotice();
    if (!notice) return;

    try {
      await this.bot.telegram.sendMessage(request.telegramUserId, notice);
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar la mesa ${request.id} a ${request.telegramUserId}: ${error}`,
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
        `No se pudo registrar el aviso de la mesa ${request.id} en el chat de ${request.telegramUserId}: ${error}`,
      );
    }
  }
}
