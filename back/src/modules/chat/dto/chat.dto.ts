import { ChatSession, ChatSessionStatus, HandoverReason } from '../../../infrastructure/database/entities/ChatSession.entity';
import { ChatMessage, MessageRole } from '../../../infrastructure/database/entities/ChatMessage.entity';
import { BookingProcess, BookingProcessStep } from '../../../infrastructure/database/entities/BookingProcess.entity';
import { User } from '../../../infrastructure/database/entities/User.entity';

export class ChatOperatorDto {
  id!: string;
  fullName!: string;

  static fromEntity(user?: User | null): ChatOperatorDto | null {
    if (!user) return null;
    const dto = new ChatOperatorDto();
    dto.id = user.id;
    // Si la referencia no vino poblada, mejor un string vacío que reventar el listado.
    dto.fullName = user.fullName ?? '';
    return dto;
  }
}

export class ChatSummaryDto {
  id!: string;
  telegramUserId!: string;
  guestDisplayName!: string | null;
  telegramUsername!: string | null;
  status!: ChatSessionStatus;
  assignedOperator!: ChatOperatorDto | null;
  lastMessageAt!: Date | null;
  lastMessagePreview!: string | null;
  lastMessageRole!: MessageRole | null;
  unreadCount!: number;
  /** Distinto de null ⇒ hay un pedido de intervención esperando a un operador. */
  handoverRequestedAt!: Date | null;
  handoverReason!: HandoverReason | null;
  createdAt!: Date;

  static fromEntity(session: ChatSession): ChatSummaryDto {
    const dto = new ChatSummaryDto();
    dto.id = session.id;
    dto.telegramUserId = session.telegramUserId;
    dto.guestDisplayName = session.guestDisplayName ?? null;
    dto.telegramUsername = session.telegramUsername ?? null;
    dto.status = session.status;
    dto.assignedOperator = ChatOperatorDto.fromEntity(session.assignedOperator);
    dto.lastMessageAt = session.lastMessageAt ?? null;
    dto.lastMessagePreview = session.lastMessagePreview ?? null;
    dto.lastMessageRole = session.lastMessageRole ?? null;
    dto.unreadCount = session.unreadCount;
    dto.handoverRequestedAt = session.handoverRequestedAt ?? null;
    dto.handoverReason = session.handoverReason ?? null;
    dto.createdAt = session.createdAt;
    return dto;
  }
}

export class ChatActiveBookingDto {
  id!: string;
  step!: BookingProcessStep;
  checkIn!: string | null;
  checkOut!: string | null;
  capacity!: number | null;

  static fromEntity(booking?: BookingProcess | null): ChatActiveBookingDto | null {
    if (!booking) return null;
    const dto = new ChatActiveBookingDto();
    dto.id = booking.id;
    dto.step = booking.step;
    dto.checkIn = booking.checkIn ?? null;
    dto.checkOut = booking.checkOut ?? null;
    dto.capacity = booking.capacity ?? null;
    return dto;
  }
}

export class ChatDetailDto extends ChatSummaryDto {
  takenOverAt!: Date | null;
  releasedAt!: Date | null;
  consecutiveBotFailures!: number;
  /**
   * Reserva a medio confirmar. El operador la necesita antes de decidir qué hacer: si cierra la
   * venta a mano sin cerrarla, al devolver el control el bot vuelve a ofrecer la misma habitación.
   */
  activeBooking!: ChatActiveBookingDto | null;
  /** Solo en la respuesta de /release: false si Telegram rechazó el aviso al huésped. */
  guestNotified?: boolean;

  static fromSession(
    session: ChatSession,
    activeBooking?: BookingProcess | null,
    guestNotified?: boolean,
  ): ChatDetailDto {
    const dto = Object.assign(new ChatDetailDto(), ChatSummaryDto.fromEntity(session));
    dto.takenOverAt = session.takenOverAt ?? null;
    dto.releasedAt = session.releasedAt ?? null;
    dto.consecutiveBotFailures = session.consecutiveBotFailures;
    dto.activeBooking = ChatActiveBookingDto.fromEntity(activeBooking);
    if (guestNotified !== undefined) dto.guestNotified = guestNotified;
    return dto;
  }
}

export class ChatMessageDto {
  id!: string;
  role!: MessageRole;
  content!: string;
  sentBy!: ChatOperatorDto | null;
  createdAt!: Date;

  static fromEntity(message: ChatMessage): ChatMessageDto {
    const dto = new ChatMessageDto();
    dto.id = message.id;
    dto.role = message.role;
    dto.content = message.content;
    dto.sentBy = ChatOperatorDto.fromEntity(message.sentBy);
    dto.createdAt = message.createdAt;
    return dto;
  }
}

/**
 * Paginación por cursor y no por offset: la conversación está viva y con offset cada mensaje
 * nuevo desplaza la ventana, así que el scroll hacia arriba repetiría o saltearía mensajes.
 */
export class CursorPageDto<T> {
  data!: T[];
  nextCursor!: string | null;
}
