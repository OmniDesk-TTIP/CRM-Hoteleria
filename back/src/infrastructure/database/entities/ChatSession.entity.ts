import { Opt } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, ManyToOne, Enum, Unique, Index } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { User } from './User.entity';
import { MessageRole } from './ChatMessage.entity';
import { CustomBaseEntity } from './CustomBase.entity';

export enum ChatSessionStatus {
  /** Chamber contesta normalmente. */
  BOT = 'BOT',
  /** El huésped pidió un humano y todavía nadie tomó la conversación. El bot ya está silenciado. */
  WAITING_HUMAN = 'WAITING_HUMAN',
  /** Un operador tiene el control. */
  HUMAN = 'HUMAN',
}

export enum HandoverReason {
  GUEST_REQUEST = 'GUEST_REQUEST',
  AI_FALLBACK = 'AI_FALLBACK',
  MANUAL_TAKEOVER = 'MANUAL_TAKEOVER',
  OUT_OF_HOURS = 'OUT_OF_HOURS',
}

/**
 * La conversación de un huésped, que hasta ahora no existía como entidad: el chat vivía
 * desperdigado en filas de `chat_messages` identificadas solo por telegramUserId.
 *
 * Ojo con `unreadCount`: es por chat y no por operador. Si dos recepcionistas abren la misma
 * conversación, el primero que la lee la marca leída para todos. Alcanza para el MVP.
 */
@Entity({ tableName: 'chat_sessions' })
@Index({ properties: ['status', 'lastMessageAt'] })
export class ChatSession extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar' })
  @Unique()
  telegramUserId!: string;

  @Enum(() => ChatSessionStatus)
  status: ChatSessionStatus & Opt = ChatSessionStatus.BOT;

  // set null y no cascade: borrar un empleado no puede borrar conversaciones de huéspedes.
  // El tipo admite null explícito: el comparador de MikroORM solo escribe NULL cuando el valor
  // es estrictamente null, y con undefined la columna podría quedar sin actualizar al liberar.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  assignedOperator?: User | null;

  @Property({ type: 'varchar', nullable: true })
  guestDisplayName?: string;

  @Property({ type: 'varchar', nullable: true })
  telegramUsername?: string;

  @Property({ type: 'datetime', nullable: true })
  lastMessageAt?: Date;

  // Desnormalizado a propósito: sin esto, listar la bandeja es un N+1 sobre chat_messages.
  @Property({ type: 'varchar', length: 200, nullable: true })
  lastMessagePreview?: string;

  @Enum({ items: () => MessageRole, nullable: true })
  lastMessageRole?: MessageRole;

  @Property({ type: 'integer' })
  unreadCount: number & Opt = 0;

  @Property({ type: 'integer' })
  consecutiveBotFailures: number & Opt = 0;

  /**
   * Distinto de null ⇒ hay un pedido de intervención pendiente y el panel lo muestra con badge.
   * Cubre los tres caminos (pedido explícito, fallback repetido y pedido fuera de horario)
   * sin necesidad de una columna `needsAttention` aparte.
   */
  @Property({ type: 'datetime', nullable: true })
  handoverRequestedAt?: Date;

  @Enum({ items: () => HandoverReason, nullable: true })
  handoverReason?: HandoverReason;

  @Property({ type: 'datetime', nullable: true })
  takenOverAt?: Date;

  @Property({ type: 'datetime', nullable: true })
  releasedAt?: Date;
}
