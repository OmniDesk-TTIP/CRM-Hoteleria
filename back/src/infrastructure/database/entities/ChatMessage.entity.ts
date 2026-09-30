import { Entity, PrimaryKey, Property, ManyToOne, Enum, Index } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { User } from './User.entity';
import { CustomBaseEntity } from './CustomBase.entity';

export enum MessageRole {
  USER = 'USER',
  BOT = 'BOT',
  /** Avisos automáticos de transición (derivación a un humano, devolución al bot, pago acreditado). */
  SYSTEM = 'SYSTEM',
  /** Escrito a mano por un recepcionista desde el panel. */
  OPERATOR = 'OPERATOR',
}

@Entity({ tableName: 'chat_messages' })
@Index({ properties: ['telegramUserId', 'createdAt'] })
export class ChatMessage extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar' })
  telegramUserId!: string;

  @Enum(() => MessageRole)
  role: MessageRole = MessageRole.USER;

  @Property({ type: 'text' })
  content!: string;

  /** Solo los mensajes OPERATOR tienen autor; el resto los escribe el sistema. */
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  sentBy?: User;
}
