import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import { ChatRepository, TelegramProfile } from './chat.repository';
import { ChatGateway } from './chat.gateway';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { BookingProcessService } from '../bookingProcess/bookingProcess.service';
import { ChatSession, ChatSessionStatus, HandoverReason } from '../../infrastructure/database/entities/ChatSession.entity';
import { ChatMessage, MessageRole } from '../../infrastructure/database/entities/ChatMessage.entity';
import { BookingProcess } from '../../infrastructure/database/entities/BookingProcess.entity';
import { User } from '../../infrastructure/database/entities/User.entity';
import { ChatDetailDto, ChatMessageDto, ChatSummaryDto, CursorPageDto } from './dto/chat.dto';
import { PaginatedResultDto } from '../reservation/dto/adminReservation.dto';
import { ListChatsQueryDto } from './dto/listChats.dto';
import { ListChatMessagesQueryDto } from './dto/listChatMessages.dto';
import { SendChatMessageDto } from './dto/sendChatMessage.dto';
import { ReleaseChatDto } from './dto/releaseChat.dto';
import { AuthUser } from '../auth/auth.types';

const PREVIEW_MAX_LENGTH = 200;
const DEFAULT_FALLBACK_THRESHOLD = 3;

export const HANDOVER_REPLY = 'Te pongo en contacto con un recepcionista, aguardá un momento por favor.';

export const RELEASE_NOTICE =
  'El operador cerró la consulta. Chamber vuelve a estar a tu disposición; si necesitás hablar con una persona otra vez, pedímelo cuando quieras.';

/** Lo primero que recibe el huésped cuando un operador toma la conversación. */
export function takeOverGreeting(operatorFullName?: string | null): string {
  const firstName = operatorFullName?.trim().split(/\s+/)[0];
  const who = firstName ? `soy ${firstName} de la recepción` : 'te escribo de la recepción';
  return `Hola, ${who}. Ya estoy con vos, ¿en qué te puedo ayudar?`;
}

export interface HandoverResult {
  /** Texto que el bot tiene que responderle al huésped. */
  replyText: string;
  /** `false` cuando el pedido llegó fuera de horario: queda encolado y el bot sigue contestando. */
  muted: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly fallbackThreshold: number;

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatGateway: ChatGateway,
    private readonly supportHoursService: SupportHoursService,
    private readonly bookingProcessService: BookingProcessService,
    configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {
    const configured = Number(configService.get<string>('HANDOVER_FALLBACK_THRESHOLD'));
    this.fallbackThreshold = Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_FALLBACK_THRESHOLD;
  }

  // Lado Telegram

  async getOrCreateSession(telegramUserId: string, profile?: TelegramProfile): Promise<ChatSession> {
    const { session, created } = await this.chatRepository.getOrCreate(telegramUserId, profile);
    if (created) this.chatGateway.emitChatCreated(ChatSummaryDto.fromEntity(session));
    return session;
  }

  isMuted(session: ChatSession): boolean {
    return session.status !== ChatSessionStatus.BOT;
  }
 
  //Persiste y publica el mensaje del huésped ANTES de llamar a la IA.
  async recordIncomingMessage(session: ChatSession, text: string): Promise<ChatMessage> {
    const message = this.chatRepository.createMessage({
      telegramUserId: session.telegramUserId,
      role: MessageRole.USER,
      content: text,
    });

    session.unreadCount += 1;
    this.touchLastMessage(session, message);
    await this.chatRepository.flush();

    this.emitMessage(session, message);
    return message;
  }

  async recordBotMessage(session: ChatSession, text: string): Promise<ChatMessage> {
    return this.recordOutgoingMessage(session, MessageRole.BOT, text);
  }


  async recordSystemMessage(session: ChatSession, text: string, updatePreview = true): Promise<ChatMessage> {
    return this.recordOutgoingMessage(session, MessageRole.SYSTEM, text, undefined, updatePreview);
  }

  /*
   * El huésped pidió un humano
   * Fuera de horario NO se silencia al bot.
   * Se encola el pedido (handoverRequestedAt) y Chamber sigue intentando ayudar.
   */
  async requestHandover(session: ChatSession, reason: HandoverReason): Promise<HandoverResult> {
    const availability = await this.supportHoursService.getAvailability();
    const previousStatus = session.status;

    if (!availability.isOpen) {
      const when = availability.nextOpeningLabel ? `te van a escribir ${availability.nextOpeningLabel}` : 'te van a escribir apenas abran';
      const replyText = `En este momento la recepción no está disponible. Ya dejé tu pedido anotado y ${when}. Mientras tanto puedo intentar ayudarte yo.`;

      session.handoverRequestedAt = new Date();
      session.handoverReason = HandoverReason.OUT_OF_HOURS;
      await this.recordSystemMessage(session, replyText);
      this.emitStatus(session, previousStatus);

      return { replyText, muted: false };
    }

    session.status = ChatSessionStatus.WAITING_HUMAN;
    session.handoverRequestedAt = new Date();
    session.handoverReason = reason;
    session.consecutiveBotFailures = 0;

    await this.recordSystemMessage(session, HANDOVER_REPLY);
    this.emitStatus(session, previousStatus);

    return { replyText: HANDOVER_REPLY, muted: true };
  }

  /**
   * Fallback prolongado: al llegar al umbral se levanta la bandera para que un operador
   * intervenga, pero el bot NO se silencia. La decisión de tomar la conversación es del humano.
   */
  async registerBotFailure(session: ChatSession): Promise<boolean> {
    session.consecutiveBotFailures += 1;
    const reached = session.consecutiveBotFailures >= this.fallbackThreshold;
    const previousStatus = session.status;

    if (reached && !session.handoverRequestedAt) {
      session.handoverRequestedAt = new Date();
      session.handoverReason = HandoverReason.AI_FALLBACK;
      await this.chatRepository.flush();
      this.emitStatus(session, previousStatus);
      this.logger.warn(`El chat ${session.id} acumuló ${session.consecutiveBotFailures} respuestas sin resolver`);
      return true;
    }

    await this.chatRepository.flush();
    return reached;
  }

  /**
   * El bot resolvió: se limpia el contador y, si la bandera la había levantado él mismo por
   * fallback, también se baja. Un pedido explícito del huésped no se pisa nunca.
   */
  async resetBotFailures(session: ChatSession): Promise<void> {
    const hadFallbackFlag = session.handoverReason === HandoverReason.AI_FALLBACK && !!session.handoverRequestedAt;
    if (session.consecutiveBotFailures === 0 && !hadFallbackFlag) return;

    const previousStatus = session.status;
    session.consecutiveBotFailures = 0;

    if (hadFallbackFlag) {
      session.handoverRequestedAt = undefined;
      session.handoverReason = undefined;
    }

    await this.chatRepository.flush();
    if (hadFallbackFlag) this.emitStatus(session, previousStatus);
  }

  /**
   * Relee el estado desde la base. `askQuestion` tarda segundos y en ese rato un operador puede
   * haber tomado el control: sin este chequeo el bot contesta encima del humano.
   */
  async wasTakenOverMeanwhile(session: ChatSession): Promise<boolean> {
    const status = await this.chatRepository.readFreshStatus(session.id);
    return status !== null && status !== ChatSessionStatus.BOT;
  }

  // Lado panel

  async list(query: ListChatsQueryDto, operator: AuthUser): Promise<PaginatedResultDto<ChatSummaryDto>> {
    const { items, total } = await this.chatRepository.findManyPaginated({
      status: query.status,
      pendingHandover: query.pendingHandover,
      assignedOperatorId: query.assignedToMe ? operator.id : undefined,
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      sortDir: query.sortDir,
    });

    return {
      data: items.map((session) => ChatSummaryDto.fromEntity(session)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(chatId: string): Promise<ChatDetailDto> {
    const session = await this.requireSession(chatId);
    return ChatDetailDto.fromSession(session, await this.findActiveBooking(session));
  }

  //historial completo para que el operador entienda qué venía hablando el bot.
  async getMessages(chatId: string, query: ListChatMessagesQueryDto): Promise<CursorPageDto<ChatMessageDto>> {
    const session = await this.requireSession(chatId);
    const before = query.before ? new Date(query.before) : undefined;

    const rows = await this.chatRepository.findMessagesBefore(session.telegramUserId, before, query.limit);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const oldest = page[page.length - 1];

    return {
      data: page.map((message) => ChatMessageDto.fromEntity(message)),
      nextCursor: hasMore && oldest ? oldest.createdAt.toISOString() : null,
    };
  }

  /**
   * CA3. Se manda a Telegram ANTES de persistir: si el huésped bloqueó el bot, el panel no puede
   * quedar mostrando un mensaje que nunca salió.
   *
   * Solo se escribe con el control tomado: así el huésped siempre recibe primero el saludo del
   * operador y la bandeja sabe quién atiende cada conversación.
   */
  async sendOperatorMessage(chatId: string, operator: AuthUser, payload: SendChatMessageDto): Promise<ChatMessageDto> {
    const session = await this.requireSession(chatId);

    if (session.status !== ChatSessionStatus.HUMAN) {
      throw new ConflictException('Tomá el control de la conversación antes de escribirle al huésped');
    }

    const delivered = await this.sendToGuest(session.telegramUserId, payload.text);
    if (!delivered) throw new BadGatewayException('No se pudo entregar el mensaje al huésped');

    const author = await this.chatRepository.findOperatorById(operator.id);
    const message = await this.recordOperatorMessage(session, author, payload.text);

    return ChatMessageDto.fromEntity(message);
  }

  /**
   * Silencia al bot desde el panel y le avisa al huésped quién lo atiende. Si Telegram falla el
   * control se toma igual (como en el release) y el panel se entera por `guestNotified`.
   */
  async takeOver(chatId: string, operator: AuthUser): Promise<ChatDetailDto> {
    const session = await this.requireSession(chatId);
    const previousStatus = session.status;

    // Repetir el click no tiene que volver a saludar al huésped.
    if (previousStatus === ChatSessionStatus.HUMAN && session.assignedOperator?.id === operator.id) {
      return ChatDetailDto.fromSession(session, await this.findActiveBooking(session));
    }

    const author = await this.chatRepository.findOperatorById(operator.id);
    this.assignToOperator(session, author);

    await this.recordSystemMessage(session, `${operator.email} tomó el control de la conversación.`, false);
    this.emitStatus(session, previousStatus);

    const greeting = takeOverGreeting(author?.fullName);
    const guestNotified = await this.sendToGuest(session.telegramUserId, greeting);
    if (guestNotified) await this.recordOperatorMessage(session, author, greeting);

    return ChatDetailDto.fromSession(session, await this.findActiveBooking(session), guestNotified);
  }

  //Libera el chat al bot
  async releaseToBot(chatId: string, operator: AuthUser, payload: ReleaseChatDto = {}): Promise<ChatDetailDto> {
    const session = await this.requireSession(chatId);
    const previousStatus = session.status;

    session.status = ChatSessionStatus.BOT;
    session.assignedOperator = null;
    session.releasedAt = new Date();
    session.consecutiveBotFailures = 0;
    session.handoverRequestedAt = undefined;
    session.handoverReason = undefined;

    const activeBooking = await this.findActiveBooking(session);
    if (payload.closeActiveBooking && activeBooking) {
      this.bookingProcessService.markCompleted(activeBooking);
    }

    const notice = await this.recordSystemMessage(session, RELEASE_NOTICE);
    const guestNotified = await this.sendToGuest(session.telegramUserId, RELEASE_NOTICE);

    this.emitStatus(session, previousStatus);
    this.emitMessage(session, notice);
    this.logger.log(`El chat ${session.id} vuelve al bot por pedido de ${operator.email}`);

    return ChatDetailDto.fromSession(session, payload.closeActiveBooking ? null : activeBooking, guestNotified);
  }

  async markAsRead(chatId: string, operator: AuthUser): Promise<{ unreadCount: number }> {
    const session = await this.requireSession(chatId);

    if (session.unreadCount !== 0) {
      session.unreadCount = 0;
      await this.chatRepository.flush();
    }

    const reader = await this.chatRepository.findOperatorById(operator.id);
    this.chatGateway.emitRead(session.id, { id: operator.id, fullName: reader?.fullName ?? operator.email });

    return { unreadCount: 0 };
  }

  // ---------------------------------------------------------------------------
  // Interno
  // ---------------------------------------------------------------------------

  private async recordOutgoingMessage(
    session: ChatSession,
    role: MessageRole,
    text: string,
    sentBy?: undefined,
    updatePreview = true,
  ): Promise<ChatMessage> {
    const message = this.chatRepository.createMessage({
      telegramUserId: session.telegramUserId,
      role,
      content: text,
      sentBy,
    });

    if (updatePreview) this.touchLastMessage(session, message);
    await this.chatRepository.flush();

    this.emitMessage(session, message);
    return message;
  }

  private async recordOperatorMessage(session: ChatSession, author: User | null, text: string): Promise<ChatMessage> {
    const message = this.chatRepository.createMessage({
      telegramUserId: session.telegramUserId,
      role: MessageRole.OPERATOR,
      content: text,
      sentBy: author ?? undefined,
    });

    this.touchLastMessage(session, message);
    await this.chatRepository.flush();

    this.emitMessage(session, message);
    return message;
  }

  private assignToOperator(session: ChatSession, operator: User | null): void {
    session.status = ChatSessionStatus.HUMAN;
    session.assignedOperator = operator;
    session.takenOverAt = new Date();
    session.handoverRequestedAt = undefined;
  }

  private async sendToGuest(telegramUserId: string, text: string): Promise<boolean> {
    try {
      await this.bot.telegram.sendMessage(telegramUserId, text);
      return true;
    } catch (error) {
      this.logger.error(`No se pudo enviar el mensaje a ${telegramUserId}: ${error}`);
      return false;
    }
  }

  private touchLastMessage(session: ChatSession, message: ChatMessage): void {
    session.lastMessageAt = message.createdAt ?? new Date();
    session.lastMessagePreview = message.content.slice(0, PREVIEW_MAX_LENGTH);
    session.lastMessageRole = message.role;
  }

  private emitMessage(session: ChatSession, message: ChatMessage): void {
    this.chatGateway.emitMessage(session.id, ChatMessageDto.fromEntity(message), {
      status: session.status,
      unreadCount: session.unreadCount,
      lastMessageAt: session.lastMessageAt ?? null,
      lastMessagePreview: session.lastMessagePreview ?? null,
    });
  }

  private emitStatus(session: ChatSession, previousStatus: ChatSessionStatus): void {
    this.chatGateway.emitStatus({
      chatId: session.id,
      status: session.status,
      previousStatus,
      assignedOperator: session.assignedOperator
        ? { id: session.assignedOperator.id, fullName: session.assignedOperator.fullName ?? '' }
        : null,
      reason: session.handoverReason ?? null,
      changedAt: new Date(),
    });
  }

  private async findActiveBooking(session: ChatSession): Promise<BookingProcess | null> {
    return this.bookingProcessService.getActive(session.telegramUserId);
  }

  private async requireSession(chatId: string): Promise<ChatSession> {
    const session = await this.chatRepository.findById(chatId);
    if (!session) throw new NotFoundException('Conversación no encontrada');
    return session;
  }
}
