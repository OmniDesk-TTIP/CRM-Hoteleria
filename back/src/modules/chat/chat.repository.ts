import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery, QueryOrder, UniqueConstraintViolationException } from '@mikro-orm/core';
import { ChatSession, ChatSessionStatus } from '../../infrastructure/database/entities/ChatSession.entity';
import { ChatMessage, MessageRole } from '../../infrastructure/database/entities/ChatMessage.entity';
import { User } from '../../infrastructure/database/entities/User.entity';

export interface TelegramProfile {
  firstName?: string;
  lastName?: string;
  username?: string;
}

export interface ListChatsFilters {
  status?: ChatSessionStatus;
  pendingHandover?: boolean;
  assignedOperatorId?: string;
  search?: string;
  page: number;
  pageSize: number;
  sortDir: 'asc' | 'desc';
}

@Injectable()
export class ChatRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<ChatSession | null> {
    return this.em.findOne(ChatSession, { id }, { populate: ['assignedOperator'] });
  }

  async findByTelegramUserId(telegramUserId: string): Promise<ChatSession | null> {
    return this.em.findOne(ChatSession, { telegramUserId }, { populate: ['assignedOperator'] });
  }

  /**
   * Telegraf procesa los updates en paralelo y no serializa por usuario: dos mensajes casi
   * simultáneos de un huésped nuevo intentan crear la misma sesión. El unique de
   * telegram_user_id es la defensa, y el INSERT va en un EntityManager forkeado para que, si
   * pierde la carrera, el error no deje sucio el contexto compartido (allowGlobalContext).
   */
  async getOrCreate(telegramUserId: string, profile?: TelegramProfile): Promise<{ session: ChatSession; created: boolean }> {
    const existing = await this.findByTelegramUserId(telegramUserId);
    if (existing) {
      this.applyProfile(existing, profile);
      return { session: existing, created: false };
    }

    const forked = this.em.fork();
    forked.create(ChatSession, { telegramUserId, ...this.profileFields(profile) });

    try {
      await forked.flush();
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) throw error;
    }

    const session = await this.findByTelegramUserId(telegramUserId);
    if (!session) throw new Error(`No se pudo crear la sesión de chat de ${telegramUserId}`);

    this.applyProfile(session, profile);
    return { session, created: true };
  }

  async findManyPaginated(filters: ListChatsFilters): Promise<{ items: ChatSession[]; total: number }> {
    const where: FilterQuery<ChatSession> = {};

    if (filters.status) where.status = filters.status;
    if (filters.pendingHandover) where.handoverRequestedAt = { $ne: null };
    if (filters.assignedOperatorId) where.assignedOperator = filters.assignedOperatorId;

    if (filters.search) {
      const term = `%${filters.search}%`;
      where.$or = [
        { telegramUserId: { $ilike: term } },
        { guestDisplayName: { $ilike: term } },
        { telegramUsername: { $ilike: term } },
      ];
    }

    // NULLS LAST explícito: en Postgres un DESC pone los nulos primero, y una conversación sin
    // mensajes encabezando la bandeja no tiene ningún sentido.
    const order = filters.sortDir === 'asc' ? QueryOrder.ASC_NULLS_LAST : QueryOrder.DESC_NULLS_LAST;

    const [items, total] = await this.em.findAndCount(ChatSession, where, {
      populate: ['assignedOperator'],
      orderBy: { lastMessageAt: order, createdAt: order },
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
    });

    return { items, total };
  }

  /**
   * Historial hacia atrás desde `before` (keyset). Devuelve `limit + 1` filas para saber si
   * quedan más sin pagar un count aparte.
   */
  async findMessagesBefore(telegramUserId: string, before: Date | undefined, limit: number): Promise<ChatMessage[]> {
    const where: FilterQuery<ChatMessage> = { telegramUserId };
    if (before) where.createdAt = { $lt: before };

    return this.em.find(ChatMessage, where, {
      populate: ['sentBy'],
      orderBy: { createdAt: QueryOrder.DESC },
      limit: limit + 1,
    });
  }

  createMessage(data: { telegramUserId: string; role: MessageRole; content: string; sentBy?: User }): ChatMessage {
    return this.em.create(ChatMessage, data);
  }

  /** Relee el estado desde la base salteando el identity map. Se usa para detectar que un operador tomó el control mientras la IA pensaba. */
  async readFreshStatus(id: string): Promise<ChatSessionStatus | null> {
    const session = await this.em.findOne(ChatSession, { id }, { refresh: true });
    return session?.status ?? null;
  }

  async findOperatorById(id: string): Promise<User | null> {
    return this.em.findOne(User, { id });
  }

  async flush(): Promise<void> {
    await this.em.flush();
  }

  private applyProfile(session: ChatSession, profile?: TelegramProfile): void {
    if (!profile) return;
    const fields = this.profileFields(profile);
    if (fields.guestDisplayName) session.guestDisplayName = fields.guestDisplayName;
    if (fields.telegramUsername) session.telegramUsername = fields.telegramUsername;
  }

  private profileFields(profile?: TelegramProfile): { guestDisplayName?: string; telegramUsername?: string } {
    if (!profile) return {};

    const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
    return {
      guestDisplayName: displayName || undefined,
      telegramUsername: profile.username || undefined,
    };
  }
}
