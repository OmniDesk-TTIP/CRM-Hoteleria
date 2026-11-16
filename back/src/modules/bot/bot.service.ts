import { EntityManager } from '@mikro-orm/core';
import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { isUUID, validate } from 'class-validator';
import { Markup } from 'telegraf';
import { RagService, ChatAction, AiResponse } from '../rag/rag.service';
import {
  ReservationService,
  ALTERNATIVE_DATES_WINDOW_DAYS,
} from '../reservation/reservation.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { ChatService } from '../chat/chat.service';
import { SpaService } from '../spa/spa.service';
import { CancellationService } from '../cancellation/cancellation.service';
import { SpaReservationService } from '../spaReservation/spaReservation.service';
import { RequestSpaBookingDto } from '../spaReservation/dto/requestSpaBooking.dto';
import { RestaurantService } from '../restaurant/restaurant.service';
import { RestaurantReservationService } from '../restaurantReservation/restaurantReservation.service';
import { RequestTableBookingDto } from '../restaurantReservation/dto/restaurantReservation.dto';
import { RoomServiceService } from '../roomService/roomService.service';
import { PrepareRoomServiceOrderDto } from '../roomService/roomService.dto';
import { PromotionService } from '../promotion/promotion.service';
import { GuestLanguageService } from '../guestLanguage/guestLanguage.service';
import { MenuPdfService } from '../menuPdf/menuPdf.service';
import { isMenuPdfKind, MenuPdfFile } from '../menuPdf/menuPdf.model';
import {
  detectHumanRequest,
  isUnresolvedReply,
} from '../chat/handover.detector';
import { SearchAvailabilityDto } from '../bookingProcess/dto/searchAvailability.dto';
import { ConfirmReservationDto } from '../reservation/dto/confirmReservation.dto';
import { ChatMessage } from '../../infrastructure/database/entities/ChatMessage.entity';
import {
  ChatSession,
  HandoverReason,
} from '../../infrastructure/database/entities/ChatSession.entity';
import {
  BookingProcess,
  BookingProcessStep,
} from '../../infrastructure/database/entities/BookingProcess.entity';
import { TelegramProfile } from '../chat/chat.repository';
import {
  escapeHtml,
  formatAlternativesFallback,
  roomServiceCancelKeyboard,
  roomServiceConfirmKeyboard,
} from '../telegram/telegram.format';

const HISTORY_SIZE = 6;

const GENERIC_FALLBACK =
  'Disculpá, no pude procesar tu mensaje. ¿Podés reformularlo?';

export const HIGH_DEMAND_REPLY =
  'El sistema está experimentando alta demanda en este segundo. Dame un minutito y volvé a escribirme.';

export const TECHNICAL_ERROR_REPLY =
  'Hubo un error técnico al procesar tu consulta. Por favor, intentá nuevamente.';

const ASK_GUEST_DATA =
  'Genial, te la reservo. Para tomarla necesito el nombre completo y el DNI del huésped que se aloja.';

const NO_PENDING_PAYMENT =
  'No tenés ninguna reserva esperando el pago de la seña. Si querés, buscamos disponibilidad: decime las fechas de entrada y salida y para cuántas personas.';

const ASK_WHICH_MENU =
  '¿Qué querés que te envíe: la carta del restó, la de room service o los servicios del spa?';

const ASK_WHICH_OPTION =
  'Antes de tomar la reserva necesito que me confirmes cuál de las opciones que te pasé preferís (fechas de entrada y salida).';

interface RichReply {
  text: string;
  keyboard?: ReturnType<typeof Markup.inlineKeyboard>;
  /** Archivo que se manda después del texto (US-25). */
  document?: MenuPdfFile;
}

type BotReply = string | RichReply;

export interface IncomingGuestMessage {
  telegramUserId: string;
  text: string;
  profile?: TelegramProfile;
  /** Se llama cuando el bot efectivamente va a procesar el mensaje (Telegram muestra "escribiendo..."). */
  onProcessingStart?: () => Promise<unknown>;
}

/**
 * Qué decidió el bot frente a un mensaje del huésped. No manda nada: quien lo llama
 * (Telegram, o el endpoint de evals) decide cómo entregarlo.
 */
export type BotTurnResult =
  /** El chat está en modo humano: el bot no contesta. */
  | { kind: 'muted' }
  /** Se derivó a un operador; `text` es el aviso para el huésped. */
  | { kind: 'handover'; text: string; muted: boolean }
  /** El bot armó una respuesta, pero un operador tomó el control mientras tanto. */
  | { kind: 'discarded'; action: ChatAction }
  | {
      kind: 'reply';
      text: string;
      action: ChatAction;
      keyboard?: RichReply['keyboard'];
      document?: MenuPdfFile;
    }
  | { kind: 'error'; text: string; error: string };

/**
 * Cerebro del bot: recibe el texto del huésped, arma el contexto, consulta a Gemini y
 * ejecuta la acción que corresponda. Es independiente del canal para poder evaluarlo
 * sin pasar por Telegram.
 */
@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly ragService: RagService,
    private readonly reservationService: ReservationService,
    private readonly bookingProcessService: BookingProcessService,
    private readonly chatService: ChatService,
    private readonly spaService: SpaService,
    private readonly spaReservationService: SpaReservationService,
    private readonly restaurantService: RestaurantService,
    private readonly restaurantReservationService: RestaurantReservationService,
    private readonly cancellationService: CancellationService,
    private readonly roomServiceService: RoomServiceService,
    private readonly promotionService: PromotionService,
    private readonly guestLanguage: GuestLanguageService,
    private readonly menuPdfService: MenuPdfService,
    private readonly em: EntityManager,
  ) {}

  async handleGuestMessage({
    telegramUserId,
    text,
    profile,
    onProcessingStart,
  }: IncomingGuestMessage): Promise<BotTurnResult> {
    let session: ChatSession | undefined;

    try {
      session = await this.chatService.getOrCreateSession(
        telegramUserId,
        profile,
      );
      // Antes de registrar el mensaje: ese flush guarda el idioma, y las respuestas y avisos que
      // salen hacia Telegram se traducen según lo que haya en la base.
      this.guestLanguage.applyDetectedLanguage(session, text);

      const incoming = await this.chatService.recordIncomingMessage(
        session,
        text,
      );

      if (this.chatService.isMuted(session)) {
        this.logger.log(
          `Chat ${session.id} en modo humano: el mensaje de ${telegramUserId} no se procesa`,
        );
        return { kind: 'muted' };
      }

      await onProcessingStart?.();

      if (detectHumanRequest(text)) {
        return this.handover(session, HandoverReason.GUEST_REQUEST);
      }

      const activeBooking =
        await this.bookingProcessService.getActive(telegramUserId);
      const lastCompletedBooking =
        await this.bookingProcessService.getLastCompleted(telegramUserId);

      const previousMessages = await this.em.find(
        ChatMessage,
        { telegramUserId, id: { $ne: incoming.id } },
        { orderBy: { createdAt: 'DESC' }, limit: HISTORY_SIZE },
      );

      const history = previousMessages.reverse();
      const servicesBlock =
        await this.spaService.getSpaContextBlock(telegramUserId);
      const restaurant =
        await this.restaurantService.getChatContext(telegramUserId);
      const cancellation =
        await this.cancellationService.getGuestContextBlock(telegramUserId);
      const hasPendingPayment =
        await this.reservationService.hasPendingPayment(telegramUserId);
      const roomService =
        await this.roomServiceService.getChatContext(telegramUserId);
      const promotions = await this.promotionService.getChatBlock();
      const aiResponse = await this.ragService.askQuestion(
        text,
        activeBooking,
        history,
        lastCompletedBooking,
        servicesBlock,
        cancellation,
        hasPendingPayment,
        restaurant,
        roomService,
        promotions,
        session.language,
      );

      if (aiResponse.action === ChatAction.REQUEST_HUMAN) {
        return this.handover(session, HandoverReason.GUEST_REQUEST);
      }

      const reply = await this.resolveBotReply(
        aiResponse,
        telegramUserId,
        activeBooking,
        text,
        history,
      );
      const {
        text: replyText,
        keyboard,
        document,
      }: RichReply = typeof reply === 'string' ? { text: reply } : reply;
      const botReply = replyText || GENERIC_FALLBACK;

      if (await this.chatService.wasTakenOverMeanwhile(session)) {
        this.logger.log(
          `Se descarta la respuesta del bot para ${telegramUserId}: un operador tomó el control`,
        );
        return { kind: 'discarded', action: aiResponse.action };
      }

      await this.chatService.recordBotMessage(session, botReply);

      if (isUnresolvedReply(botReply))
        await this.chatService.registerBotFailure(session);
      else await this.chatService.resetBotFailures(session);

      return {
        kind: 'reply',
        text: botReply,
        action: aiResponse.action,
        keyboard,
        document,
      };
    } catch (error: unknown) {
      this.logger.error(`Error procesando el mensaje: ${String(error)}`);

      if (session) await this.registerFailureSafely(session);

      const isHighDemand =
        (error as { status?: number } | null)?.status === 503;
      return {
        kind: 'error',
        text: isHighDemand ? HIGH_DEMAND_REPLY : TECHNICAL_ERROR_REPLY,
        error: String(error),
      };
    }
  }

  async registerFailureSafely(session: ChatSession): Promise<void> {
    try {
      await this.chatService.registerBotFailure(session);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el fallo del bot para ${session.telegramUserId}: ${error}`,
      );
    }
  }

  private async handover(
    session: ChatSession,
    reason: HandoverReason,
  ): Promise<BotTurnResult> {
    const { replyText, muted } = await this.chatService.requestHandover(
      session,
      reason,
    );
    this.logger.log(
      `Handover de ${session.telegramUserId} (${reason}); bot silenciado: ${muted}`,
    );
    return { kind: 'handover', text: replyText, muted };
  }

  private async resolveBotReply(
    aiResponse: AiResponse,
    telegramUserId: string,
    activeBooking: BookingProcess | null,
    userText: string,
    history: ChatMessage[],
  ): Promise<BotReply> {
    switch (aiResponse.action) {
      case ChatAction.SEARCH_AVAILABILITY:
        return this.resolveSearchAvailability(
          aiResponse.datos,
          telegramUserId,
          activeBooking,
          userText,
          history,
        );
      case ChatAction.CONFIRM_RESERVATION:
        return this.resolveConfirmReservation(
          aiResponse.datos,
          telegramUserId,
          activeBooking,
        );
      case ChatAction.SEND_PAYMENT_LINK:
        return (
          (await this.reservationService.buildPendingPaymentReply(
            telegramUserId,
          )) ?? NO_PENDING_PAYMENT
        );
      case ChatAction.REQUEST_SPA_BOOKING:
        return this.resolveSpaBooking(aiResponse.datos, telegramUserId);
      case ChatAction.REQUEST_TABLE_BOOKING:
        return this.resolveTableBooking(aiResponse.datos, telegramUserId);
      case ChatAction.PREPARE_ROOM_SERVICE_ORDER:
        return this.resolvePrepareRoomService(aiResponse.datos, telegramUserId);
      case ChatAction.CANCEL_ROOM_SERVICE_ORDER:
        return this.resolveCancelRoomService(telegramUserId);
      case ChatAction.SEND_MENU_PDF:
        return this.resolveSendMenuPdf(aiResponse.datos, telegramUserId);
      case ChatAction.CANCEL_RESERVATION:
        return this.resolveCancelReservation(aiResponse.datos, telegramUserId);
      case ChatAction.REGISTER_REFUND_ACCOUNT:
        return this.resolveRegisterRefundAccount(
          aiResponse.datos,
          telegramUserId,
        );
      default:
        return (
          escapeHtml(aiResponse.texto || '') ||
          'Disculpá, no entendí bien eso. ¿Podés reformularlo?'
        );
    }
  }

  private async resolveCancelReservation(
    datos: unknown,
    telegramUserId: string,
  ): Promise<string> {
    const reservationId = (datos as { reservationId?: unknown } | null)
      ?.reservationId;
    if (typeof reservationId !== 'string' || !isUUID(reservationId)) {
      return '¿Me confirmás cuál de tus reservas querés cancelar (fechas de entrada y salida)?';
    }

    const result = await this.cancellationService.cancelForGuest(
      telegramUserId,
      reservationId,
    );
    return result.ok ? result.reply : escapeHtml(result.reason);
  }

  private async resolveRegisterRefundAccount(
    datos: unknown,
    telegramUserId: string,
  ): Promise<string> {
    const { reservationId, alias, holderName } = (datos ?? {}) as {
      reservationId?: unknown;
      alias?: unknown;
      holderName?: unknown;
    };
    if (typeof reservationId !== 'string' || !isUUID(reservationId)) {
      return '¿Me confirmás de qué reserva es la devolución (fechas de entrada y salida)?';
    }

    const result = await this.cancellationService.registerRefundAccountForGuest(
      telegramUserId,
      reservationId,
      alias,
      holderName,
    );
    return result.ok ? result.reply : escapeHtml(result.reason);
  }

  private async resolveSpaBooking(
    datos: unknown,
    telegramUserId: string,
  ): Promise<string> {
    const bookingDto = plainToInstance(RequestSpaBookingDto, datos);
    const validationErrors = await validate(bookingDto);
    if (validationErrors.length > 0) {
      const invalidFields = validationErrors.map((error) => error.property);
      this.logger.warn(
        `Pedido de turno incompleto de ${telegramUserId}; inválidos: ${invalidFields.join(', ')}`,
      );
      if (invalidFields.includes('fullName') || invalidFields.includes('dni')) {
        return '¿Me pasás tu nombre completo y tu DNI (solo los números, sin puntos)?';
      }
      return '¿Me confirmás qué servicio querés, qué día (DD-MM-YYYY) y a qué hora?';
    }

    const result = await this.spaReservationService.requestSpa(
      telegramUserId,
      bookingDto,
    );
    return result.ok ? result.reply : escapeHtml(result.reason);
  }

  private async resolveTableBooking(
    datos: unknown,
    telegramUserId: string,
  ): Promise<string> {
    const bookingDto = plainToInstance(RequestTableBookingDto, datos);
    const validationErrors = await validate(bookingDto);
    if (validationErrors.length > 0) {
      this.logger.warn(
        `Pedido de mesa incompleto de ${telegramUserId}; inválidos: ${validationErrors.map((error) => error.property).join(', ')}`,
      );
      return '¿Me confirmás para qué día (DD-MM-YYYY), a qué hora y para cuántas personas querés la mesa?';
    }

    const result = await this.restaurantReservationService.requestTable(
      telegramUserId,
      bookingDto,
    );
    return result.ok ? result.reply : escapeHtml(result.reason);
  }

  private async resolvePrepareRoomService(
    datos: unknown,
    telegramUserId: string,
  ): Promise<BotReply> {
    const orderDto = plainToInstance(PrepareRoomServiceOrderDto, datos);
    const validationErrors = await validate(orderDto);
    if (validationErrors.length > 0) {
      this.logger.warn(
        `Pedido de room service incompleto de ${telegramUserId}; inválidos: ${validationErrors.map((error) => error.property).join(', ')}`,
      );
      return '¿Me confirmás qué platos querés y cuántos de cada uno?';
    }

    const result = await this.roomServiceService.prepareOrder(
      telegramUserId,
      orderDto,
    );
    if (!result.ok) return escapeHtml(result.reason);
    return result.orderId
      ? {
          text: result.reply,
          keyboard: roomServiceConfirmKeyboard(result.orderId),
        }
      : result.reply;
  }

  private async resolveCancelRoomService(
    telegramUserId: string,
  ): Promise<BotReply> {
    const result = await this.roomServiceService.requestCancel(telegramUserId);
    if (!result.ok) return escapeHtml(result.reason);
    return result.orderId
      ? {
          text: result.reply,
          keyboard: roomServiceCancelKeyboard(result.orderId),
        }
      : result.reply;
  }

  private async resolveSendMenuPdf(
    datos: unknown,
    telegramUserId: string,
  ): Promise<BotReply> {
    const kind = (datos as { menu?: unknown } | null)?.menu;
    if (!isMenuPdfKind(kind)) return ASK_WHICH_MENU;

    const result = await this.menuPdfService.buildForGuest(
      kind,
      telegramUserId,
    );
    return result.ok
      ? { text: result.reply, document: result.document }
      : escapeHtml(result.reason);
  }

  private async resolveSearchAvailability(
    datos: unknown,
    telegramUserId: string,
    activeBooking: BookingProcess | null,
    userText: string,
    history: ChatMessage[],
  ): Promise<string> {
    const searchDto = plainToInstance(SearchAvailabilityDto, datos);
    const validationErrors = await validate(searchDto);
    if (validationErrors.length > 0) {
      const [firstError] = validationErrors;
      throw new Error(
        Object.values(firstError.constraints || {})[0] ||
          'Datos de búsqueda de disponibilidad inválidos',
      );
    }

    if (this.isOfferAlreadyPending(activeBooking, searchDto)) {
      this.logger.log(
        `Se ignora una búsqueda repetida de ${telegramUserId}: ya hay una oferta esperando confirmación`,
      );
      return ASK_GUEST_DATA;
    }

    const result = await this.reservationService.searchAvailability(
      telegramUserId,
      activeBooking,
      searchDto,
    );
    if (result.available) return result.reply;

    if (result.alternatives.length === 0) {
      return `Lamentablemente no nos quedan habitaciones para ${searchDto.capacity} personas en esas fechas ni en los ${ALTERNATIVE_DATES_WINDOW_DAYS} días cercanos. ¿Probamos con otras fechas?`;
    }

    const aiReply = await this.ragService.composeUnavailableReply(
      userText,
      history,
      searchDto,
      result.alternatives,
    );
    return (
      escapeHtml(aiReply || '') ||
      formatAlternativesFallback(result.alternatives)
    );
  }

  private isOfferAlreadyPending(
    activeBooking: BookingProcess | null,
    searchDto: SearchAvailabilityDto,
  ): boolean {
    return (
      !!activeBooking &&
      activeBooking.step === BookingProcessStep.PENDING_CONFIRMATION &&
      activeBooking.checkIn === searchDto.checkIn &&
      activeBooking.checkOut === searchDto.checkOut &&
      activeBooking.capacity === searchDto.capacity
    );
  }

  private async resolveConfirmReservation(
    datos: unknown,
    telegramUserId: string,
    activeBooking: BookingProcess | null,
  ): Promise<string> {
    // Nunca se responde con el texto del modelo: si no hay nada que confirmar, Gemini suele
    // contestar como si hubiera reservado ("ya registré tus datos") sin que exista la reserva.
    if (activeBooking?.step === BookingProcessStep.IN_PROGRESS) {
      return activeBooking.checkIn &&
        activeBooking.checkOut &&
        activeBooking.capacity
        ? ASK_WHICH_OPTION
        : '¿Para qué fechas de entrada y salida, y para cuántas personas, buscamos la habitación?';
    }
    if (
      !activeBooking ||
      activeBooking.step !== BookingProcessStep.PENDING_CONFIRMATION
    ) {
      return (
        (await this.reservationService.buildPendingPaymentReply(
          telegramUserId,
        )) ??
        'Para tomar una reserva primero necesito las fechas de entrada y salida y para cuántas personas es.'
      );
    }

    const confirmDto = plainToInstance(ConfirmReservationDto, datos);
    const validationErrors = await validate(confirmDto);
    if (validationErrors.length > 0) {
      const invalidFields = validationErrors.map((error) => error.property);
      this.logger.warn(
        `Confirmación incompleta de ${telegramUserId}; faltan o son inválidos: ${invalidFields.join(', ')}`,
      );

      if (!invalidFields.includes('fullName'))
        return '¿Me pasás el DNI del huésped que se aloja? Solo los números, sin puntos.';
      if (!invalidFields.includes('dni'))
        return '¿Me pasás el nombre completo del huésped que se aloja?';
      return ASK_GUEST_DATA;
    }

    return this.reservationService.confirmReservation(
      telegramUserId,
      activeBooking,
      confirmDto,
    );
  }
}
