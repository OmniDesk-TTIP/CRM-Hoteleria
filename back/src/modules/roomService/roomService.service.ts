import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import {
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
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

/**
 * Resultado de una acción del huésped por el chat. Los rechazos no son excepciones: son
 * respuestas esperables y `reason` ya está redactado para mostrárselo. `orderId` viaja en los
 * botones de Telegram (confirmar o cancelar ese pedido puntual).
 */
export type RoomServiceChatResult =
  { ok: true; reply: string; orderId?: string } | { ok: false; reason: string };

export interface RoomServiceChatContext {
  block: string;
  /** Huésped alojado, servicio abierto y con platos: Chamber puede tomar el pedido. */
  canOrder: boolean;
  /** Tiene un pedido en curso (Recibido o En preparación) sobre el que puede preguntar o cancelar. */
  hasOpenOrder: boolean;
}

const DEFAULT_LANDING_ROOM_SERVICE_PATH = '/room-service';

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
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  // ───────── Chamber ─────────

  /** CA1/CA2/CA5: lo que Chamber sabe del room service para este huésped. */
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
        menuUrl: this.getMenuUrl(),
        openOrder,
      }),
      canOrder: stay !== null && isOpenNow && menu.length > 0,
      hasOpenOrder: openOrder !== null,
    };
  }

  /**
   * CA3/CA4: valida el pedido y guarda un borrador. La respuesta es el resumen armado por el
   * servidor (no por el modelo) y los botones de Telegram apuntan a `orderId`: nada queda
   * registrado hasta que el huésped toque "Confirmar pedido".
   */
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

    return {
      ok: true,
      orderId: draft.id,
      reply: [
        draft.getSummary(),
        '',
        '¿Lo confirmás? Tocá <b>Confirmar pedido</b> para enviarlo a la cocina.',
      ].join('\n'),
    };
  }

  /**
   * CA4/CA9: el huésped tocó "Confirmar pedido". Recién acá el pedido queda Recibido, visible en
   * el panel y asociado a su reserva, y se genera el link de pago.
   */
  async confirmOrder(
    telegramUserId: string,
    orderId: string,
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

    const error = order.confirm(now);
    if (error) return { ok: false, reason: error };
    const confirmed = await this.roomServiceRepository.confirmIfDraft(order);
    if (!confirmed) {
      return { ok: false, reason: 'Ese pedido ya estaba confirmado.' };
    }

    const paymentLink = await this.createPaymentLink(order, check.stay);
    const reply = [
      `✅ ¡Listo! Recibimos tu pedido para la habitación ${escapeHtml(order.roomNumber)}. Te aviso por acá cuando esté en preparación y cuando te lo entreguen.`,
      '',
      `Total: $${order.total}`,
      '',
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

  /** El huésped tocó "No, gracias" en el resumen: se descarta el borrador. */
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

  /**
   * CA8: el huésped pidió cancelar. Si el pedido sigue Recibido, devuelve la pregunta de
   * confirmación (los botones apuntan a `orderId`); si ya está en preparación, el motivo.
   */
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

  /** CA8: el huésped confirmó la cancelación con el botón. */
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

    // Si recepción lo pasó a preparación justo ahora, la cancelación ya no corre.
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

  // ───────── Panel ─────────

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

  /** CA7: el panel cambia el estado y el huésped recibe el aviso por Chamber. */
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
    const notice = order.getStatusNotice();
    if (notice) await this.notifyGuest(order, notice);
    return RoomServiceOrderDto.fromModel(order);
  }

  // ───────── Pago (CA9) ─────────

  /**
   * Procesa un pago de Mercado Pago de un pedido (webhook o redirect de vuelta). Es idempotente:
   * el webhook y el redirect suelen llegar casi juntos y el aviso sale una sola vez.
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

    await this.notifyGuest(order, order.getPaymentNotice());
    this.logger.log(
      `[${source}] Pedido ${order.id} pagado con el pago ${payment.id}`,
    );
  }

  // ───────── Landing (CA2) ─────────

  async getPublicMenu(): Promise<PublicRoomServiceDto> {
    const hours = await this.getHours();
    if (!hours.enabled) return toPublicRoomService(null, []);
    return toPublicRoomService(
      hours,
      await this.restaurantService.listRoomServiceMenu(),
    );
  }

  getMenuUrl(): string | null {
    const landing = this.configService.get<string>('LANDING_BASE_URL');
    return landing
      ? `${landing.replace(/\/+$/, '')}${DEFAULT_LANDING_ROOM_SERVICE_PATH}`
      : null;
  }

  // ───────── Internos ─────────

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

  private findCurrentStay(
    telegramUserId: string,
    now: Date,
  ): Promise<CurrentStay | null> {
    return this.roomServiceRepository.findCurrentStay(
      telegramUserId,
      this.spaService.getHotelClock(now).today,
    );
  }

  /** CA1/CA5: huésped alojado hoy y servicio abierto ahora; si no, el motivo para el huésped. */
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

  /** Genera el link de Mercado Pago del pedido; null si no se pudo (el pedido igual queda). */
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

  /**
   * Avisa al huésped por Telegram y deja el aviso en el chat, igual que el spa y el restó. Un
   * problema de mensajería no puede impedir el cambio: el estado ya quedó guardado.
   */
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
