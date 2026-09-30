import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from './ws-jwt.guard';
import { JwtPayload } from '../auth/auth.types';
import { ChatMessageDto, ChatSummaryDto } from './dto/chat.dto';
import { ChatSessionStatus, HandoverReason } from '../../infrastructure/database/entities/ChatSession.entity';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Room con todos los operadores conectados: recibe lo que afecta a la bandeja. */
export const OPERATORS_ROOM = 'operators';

/** Room por conversación: solo quienes la tienen abierta reciben el texto completo. */
export const chatRoom = (chatId: string): string => `chat:${chatId}`;

export interface ChatSessionSummaryPatch {
  status: ChatSessionStatus;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastMessagePreview: string | null;
}

export interface ChatStatusEvent {
  chatId: string;
  status: ChatSessionStatus;
  previousStatus: ChatSessionStatus;
  assignedOperator: { id: string; fullName: string } | null;
  reason: HandoverReason | null;
  changedAt: Date;
}

@WebSocketGateway({
  namespace: '/ws/chats',
  cors: {
    origin: (_origin: string | undefined, callback: (err: Error | null, origin?: string) => void) =>
      callback(null, process.env.FRONTEND_BASE_URL ?? 'http://localhost:5173'),
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  private readonly server?: Server;

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: string } | undefined)?.token;

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload & { exp?: number }>(token ?? '');
      client.data.user = { id: payload.sub, email: payload.email, role: payload.role };
      client.data.tokenExp = payload.exp;
      await client.join(OPERATORS_ROOM);
    } catch {
      client.emit('auth:error', { message: 'Token inválido o expirado' });
      client.disconnect(true);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chat:subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: string }): Promise<{ ok: boolean }> {
    if (!body?.chatId || !UUID_REGEX.test(body.chatId)) return { ok: false };

    await client.join(chatRoom(body.chatId));
    return { ok: true };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('chat:unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: string }): Promise<{ ok: boolean }> {
    if (!body?.chatId || !UUID_REGEX.test(body.chatId)) return { ok: false };

    await client.leave(chatRoom(body.chatId));
    return { ok: true };
  }

  emitChatCreated(chat: ChatSummaryDto): void {
    this.emit(OPERATORS_ROOM, 'chat:created', { chat });
  }

  emitMessage(chatId: string, message: ChatMessageDto, session: ChatSessionSummaryPatch): void {
    const payload = { chatId, message, session };
    this.emit(chatRoom(chatId), 'chat:message', payload);
    this.emit(OPERATORS_ROOM, 'chat:message', payload);
  }

  emitStatus(event: ChatStatusEvent): void {
    this.emit(chatRoom(event.chatId), 'chat:status', event);
    this.emit(OPERATORS_ROOM, 'chat:status', event);
  }

  emitRead(chatId: string, readBy: { id: string; fullName: string }): void {
    const payload = { chatId, unreadCount: 0, readBy };
    this.emit(chatRoom(chatId), 'chat:read', payload);
    this.emit(OPERATORS_ROOM, 'chat:read', payload);
  }

  private emit(room: string, event: string, payload: unknown): void {
    try {
      this.server?.to(room).emit(event, payload);
    } catch (error) {
      this.logger.warn(`No se pudo emitir "${event}" a ${room}: ${error}`);
    }
  }
}
