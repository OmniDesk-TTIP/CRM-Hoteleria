import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import {
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import { AccountService } from '../account/account.service';
import { roomServiceConsumption } from '../account/consumption.model';
import { ChatService } from '../chat/chat.service';
import { PaymentService } from '../payment/payment.service';
import { MenuItemModel } from '../restaurant/model/restaurant.model';
import { RestaurantService } from '../restaurant/restaurant.service';
import { SpaService } from '../spa/spa.service';
import { escapeHtml, htmlLink } from '../telegram/telegram.format';
import {
  buildRoomServiceBlock,
  CurrentStay,
  describeRoomServiceHours,
  isRoomServiceOpen,
  OrderLine,
  RoomServiceHours,
  RoomServiceOrderModel,
  RoomServicePaymentOption,
} from './roomService.model';
import { RoomServiceRepository } from './roomService.repository';
import {
  ListRoomServiceOrdersQueryDto,
  PaginatedRoomServiceOrdersDto,
  PrepareRoomServiceOrderDto,
  PublicRoomServiceDto,
  RoomServiceOrderDto,
  toPublicRoomService,
} from './roomService.dto';

export type RoomServiceChatResult =
  | {
      ok: true;
      reply: string;
      orderId?: string;
      /** Solo en el resumen: si se ofrece "Cargar a la habitación" (cuenta abierta). */
      canChargeToRoom?: boolean;
    }
  | { ok: false; reason: string };

export const NO_ROOM_CHARGE_REASON =
  'En este momento no puedo cargarlo a tu habitación porque tu cuenta no está habilitada. Si querés, tocá "Pagar ahora" y te paso el link de pago.';

export interface RoomServiceChatContext {
  block: string;
  canOrder: boolean;
  hasOpenOrder: boolean;
}

const NOT_STAYING_REASON =
  'El room service es exclusivo para huéspedes alojados en el hotel.';

@Injectable()
export class RoomServiceService {
  private readonly logger = new Logger(RoomServiceService.name);

  constructor(
    private readonly roomServiceRepository: RoomServiceRepository,
    private readonly restaurantService: RestaurantService,
    private readonly spaService: SpaService,
    private readonly chatService: ChatService,
    private readonly paymentService: PaymentService,
    private readonly accountService: AccountService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  async getChatContext(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<RoomServiceChatContext> {
    const hours = await this.getHours();
    const stay = hours.enabled
      ? await this.findCurrentStay(telegramUserId, now)
      : null;
    const isOpenNow = this.isOpenAt(hours, now);

    const [menu, openOrder] = stay
      ? await Promise.all([
          this.restaurantService.listRoomServiceMenu(),
          this.roomServiceRepository.findLatestOpen(telegramUserId),
        ])
      : [[], null];

    return {
      block: buildRoomServiceBlock({
        hours,
        isOpenNow,
        stay,
        menu,
        openOrder,
      }),
      canOrder: stay !== null && isOpenNow && menu.length > 0,
      hasOpenOrder: openOrder !== null,
    };
  }

  async prepareOrder(
    telegramUserId: string,
    dto: PrepareRoomServiceOrderDto,
    now: Date = new Date(),
  ): Promise<RoomServiceChatResult> {
    const check = await this.checkCanOrder(telegramUserId, now);
    if (!check.ok) return check;

    const menu = await this.restaurantService.listRoomServiceMenu();
    const byId = new Map<string, MenuItemModel>(
      menu.map((item) => [item.id, item]),
    );

    const lines: OrderLine[] = [];
    for (const line of dto.items) {
      const menuItem = byId.get(line.menuItemId);
      if (!menuItem) {
        return {
          ok: false,
          reason:
            'Uno de los platos que pediste no está disponible en la carta de room service. ¿Querés que te pase la carta?',
        };
      }
      lines.push({
        menuItem,
        quantity: line.quantity,
        notes: line.notes?.trim() || null,
      });
    }

    const linesError = RoomServiceOrderModel.getLinesError(lines);
    if (linesError) return { ok: false, reason: linesError };

    const draft = RoomServiceOrderModel.createDraft({
      telegramUserId,
      stay: check.stay,
      lines,
      notes: dto.notes?.trim() || null,
      now,
    });
    await this.roomServiceRepository.replaceDraft(draft);

    const canChargeToRoom = await this.accountService.hasOpenAccount(
      check.stay.reservationId,
    );
    return {
      ok: true,
      orderId: draft.id,
      canChargeToRoom,
      reply: [
        draft.getSummary(),
        '',
        canChargeToRoom
          ? '¿Cómo querés pagarlo? Tocá <b>Pagar ahora</b> para recibir el link de pago o <b>Cargar a la habitación</b> para abonarlo al final de tu estadía. Con cualquiera de los dos lo enviamos a la cocina.'
          : '¿Lo confirmás? Tocá <b>Pagar ahora</b> para enviarlo a la cocina y recibir el link de pago.',
      ].join('\n'),
    };
  }

  async confirmOrder(
    telegramUserId: string,
    orderId: string,
    paymentOption: RoomServicePaymentOption = RoomServicePaymentOption.PAY_NOW,
    now: Date = new Date(),
  ): Promise<RoomServiceChatResult> {
    const order = await this.roomServiceRepository.findById(orderId);
    if (!order || order.telegramUserId !== telegramUserId) {
      return {
        ok: false,
        reason:
          'No encontré ese pedido. Si querés, decime de nuevo qué te gustaría pedir.',
      };
    }
    if (!order.isDraft()) {
      return { ok: false, reason: 'Ese pedido ya estaba confirmado.' };
    }
    if (order.isDraftExpired(now)) {
      await this.roomServiceRepository.deleteDraft(order.id, telegramUserId);
      return {
        ok: false,
        reason:
          'Ese resumen ya venció. Decime de nuevo qué querés pedir y te lo armo otra vez.',
      };
    }

    const check = await this.checkCanOrder(telegramUserId, now);
    if (!check.ok) return check;

    const chargeToRoom =
      paymentOption === RoomServicePaymentOption.CHARGE_TO_ROOM;
    // se chequea antes de confirmar: si la cuenta se cerró, el borrador sigue y puede pagar ahora
    if (
      chargeToRoom &&
      !(await this.accountService.hasOpenAccount(order.roomReservationId))
    ) {
      return { ok: false, reason: NO_ROOM_CHARGE_REASON };
    }

    const error = order.confirm(now);
    if (error) return { ok: false, reason: error };
    const confirmed = await this.roomServiceRepository.confirmIfDraft(order);
    if (!confirmed) {
      return { ok: false, reason: 'Ese pedido ya estaba confirmado.' };
    }
    await this.syncAccount(order, now);

    const received = [
      `✅ ¡Listo! Recibimos tu pedido para la habitación ${escapeHtml(order.roomNumber)}. Te aviso por acá cuando esté en preparación y cuando te lo entreguen.`,
      '',
      `Total: $${order.total}`,
      '',
    ];
    if (chargeToRoom) {
      return {
        ok: true,
        orderId: order.id,
        reply: [
          ...received,
          '🧾 Lo cargué a la cuenta de tu habitación: lo abonás al final de tu estadía.',
        ].join('\n'),
      };
    }

    const paymentLink = await this.createPaymentLink(order, check.stay);
    const reply = [
      ...received,
      ...(paymentLink
        ? [
            '💳 Podés pagarlo desde tu habitación con este link:',
            htmlLink(paymentLink, paymentLink),
          ]
        : [
            'No pude generar el link de pago en este momento; el total quedó cargado en tu reserva y lo podés abonar en recepción.',
          ]),
    ].join('\n');
    return { ok: true, orderId: order.id, reply };
  }

  async discardDraft(
    telegramUserId: string,
    orderId: string,
  ): Promise<RoomServiceChatResult> {
    await this.roomServiceRepository.deleteDraft(orderId, telegramUserId);
    return {
      ok: true,
      reply:
        'Listo, no envié el pedido. Si querés armar otro, decime qué te gustaría.',
    };
  }

  async requestCancel(telegramUserId: string): Promise<RoomServiceChatResult> {
    const order =
      await this.roomServiceRepository.findLatestOpen(telegramUserId);
    if (!order) {
      return {
        ok: false,
        reason: 'No tenés pedidos de room service en curso para cancelar.',
      };
    }

    const error = order.getGuestCancelError();
    if (error) return { ok: false, reason: error };

    return {
      ok: true,
      orderId: order.id,
      reply: `¿Seguro que querés cancelar tu pedido de room service (${escapeHtml(order.describeItems())}, total $${order.total})? No se puede deshacer.`,
    };
  }

  async cancelOrder(
    telegramUserId: string,
    orderId: string,
  ): Promise<RoomServiceChatResult> {
    const order = await this.roomServiceRepository.findById(orderId);
    if (!order || order.telegramUserId !== telegramUserId) {
      return { ok: false, reason: 'No encontré ese pedido.' };
    }

    const error = order.cancelByGuest();
    if (error) return { ok: false, reason: error };

    const cancelled = await this.roomServiceRepository.cancelIfReceived(
      order.id,
    );
    if (!cancelled) {
      return {
        ok: false,
        reason:
          'Tu pedido ya está en preparación, así que no lo puedo cancelar. Si necesitás algo, te paso con recepción.',
      };
    }
    await this.syncAccount(order);

    const refund =
      order.paymentStatus === RoomServicePaymentStatus.PAID
        ? ' Como ya lo habías pagado, recepción se va a comunicar para la devolución.'
        : '';
    return {
      ok: true,
      orderId: order.id,
      reply: `Listo, cancelé tu pedido de room service.${refund}`,
    };
  }

  async list(
    query: ListRoomServiceOrdersQueryDto,
  ): Promise<PaginatedRoomServiceOrdersDto> {
    const { items, total } =
      await this.roomServiceRepository.findManyPaginated(query);
    return {
      items: items.map((model) => RoomServiceOrderDto.fromModel(model)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async changeStatus(
    id: string,
    status: RoomServiceOrderStatus,
  ): Promise<RoomServiceOrderDto> {
    const order = await this.roomServiceRepository.findById(id);
    if (!order || order.isDraft()) {
      throw new NotFoundException('Pedido no encontrado');
    }

    const error = order.changeStatus(status);
    if (error) throw new BadRequestException(error);

    await this.roomServiceRepository.updateStatus(order);
    await this.syncAccount(order);
    const notice = order.getStatusNotice();
    if (notice) await this.notifyGuest(order, notice);
    return RoomServiceOrderDto.fromModel(order);
  }

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

    const order = await this.roomServiceRepository.findById(
      payment.external_reference,
    );
    if (!order) {
      this.logger.warn(
        `[${source}] Pedido de room service no encontrado: external_reference=${payment.external_reference}`,
      );
      return;
    }

    const error = order.confirmPayment();
    if (error) {
      this.logger.log(`[${source}] Pedido ${order.id}: ${error}`);
      return;
    }

    const marked = await this.roomServiceRepository.markPaidIfPending(
      order.id,
      String(payment.id),
    );
    if (!marked) return;
    order.mpPaymentId = String(payment.id);
    await this.syncAccount(order);

    await this.notifyGuest(order, order.getPaymentNotice());
    this.logger.log(
      `[${source}] Pedido ${order.id} pagado con el pago ${payment.id}`,
    );
  }

  async getPublicMenu(): Promise<PublicRoomServiceDto> {
    const hours = await this.getHours();
    if (!hours.enabled) return toPublicRoomService(null, []);
    return toPublicRoomService(
      hours,
      await this.restaurantService.listRoomServiceMenu(),
    );
  }

  private async getHours(): Promise<RoomServiceHours> {
    const { settings } = await this.restaurantService.getSettings();
    return {
      enabled: settings.roomServiceEnabled,
      opensAt: settings.roomServiceOpensAt,
      closesAt: settings.roomServiceClosesAt,
    };
  }

  private isOpenAt(hours: RoomServiceHours, now: Date): boolean {
    return isRoomServiceOpen(hours, this.spaService.getHotelClock(now).minutes);
  }

  /** La estadía en curso del huésped (alojado hoy), o null. */
  findCurrentStay(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<CurrentStay | null> {
    return this.roomServiceRepository.findCurrentStay(
      telegramUserId,
      this.spaService.getHotelClock(now).today,
    );
  }

  private async checkCanOrder(
    telegramUserId: string,
    now: Date,
  ): Promise<{ ok: true; stay: CurrentStay } | { ok: false; reason: string }> {
    const hours = await this.getHours();
    if (!hours.enabled) {
      return {
        ok: false,
        reason: 'El room service no está disponible por el momento.',
      };
    }

    const stay = await this.findCurrentStay(telegramUserId, now);
    if (!stay) return { ok: false, reason: NOT_STAYING_REASON };

    if (!this.isOpenAt(hours, now)) {
      return {
        ok: false,
        reason: `En este momento el room service está cerrado. Atiende ${describeRoomServiceHours(hours)}.`,
      };
    }
    return { ok: true, stay };
  }

  /**
   * US-27: el pedido confirmado es un cargo en la cuenta de la reserva; si se cancela, se anula, y
   * si se paga con el link, se registra el pago. No hace nada si la reserva no tiene cuenta abierta.
   */
  private syncAccount(order: RoomServiceOrderModel, now: Date = new Date()) {
    return this.accountService.syncConsumption(
      order.roomReservationId,
      roomServiceConsumption(order),
      now,
    );
  }

  private async createPaymentLink(
    order: RoomServiceOrderModel,
    stay: CurrentStay,
  ): Promise<string | null> {
    try {
      const { preferenceId, initPoint } =
        await this.paymentService.createRoomServicePreference({
          id: order.id,
          roomNumber: order.roomNumber,
          amount: order.total,
          fullName: stay.guestFullName,
          dni: stay.guestDni,
        });
      await this.roomServiceRepository.attachPreference(
        order.id,
        preferenceId,
        initPoint,
      );
      order.mpInitPoint = initPoint;
      return initPoint;
    } catch (error) {
      this.logger.error(
        `No se pudo crear el link de pago del pedido ${order.id}: ${error}`,
      );
      return null;
    }
  }

  private async notifyGuest(
    order: RoomServiceOrderModel,
    notice: string,
  ): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(order.telegramUserId, notice);
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar el pedido ${order.id} a ${order.telegramUserId}: ${error}`,
      );
      return;
    }

    try {
      const session = await this.chatService.getOrCreateSession(
        order.telegramUserId,
      );
      await this.chatService.recordSystemMessage(session, notice);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el aviso del pedido ${order.id} en el chat de ${order.telegramUserId}: ${error}`,
      );
    }
  }
}
