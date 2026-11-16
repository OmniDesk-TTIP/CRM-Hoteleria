import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';
import { Reservation } from './Reservation.entity';

export enum ArrivalMessageType {
  /** Recordatorio 24 hs antes del check-in. */
  REMINDER = 'REMINDER',
  /** Bienvenida del día del check-in. */
  WELCOME = 'WELCOME',
}

export enum ArrivalMessageStatus {
  /** El mensaje se reservó y se está mandando por Telegram. */
  PENDING = 'PENDING',
  SENT = 'SENT',
  /** El huésped bloqueó al bot. No se reintenta. */
  BLOCKED = 'BLOCKED',
  /** Telegram rechazó el mensaje por otro motivo. No se reintenta. */
  FAILED = 'FAILED',
}

/**
 * Mensajes automáticos previos a la llegada (US-23). Una fila por reserva y tipo: la restricción
 * única hace que cada mensaje salga una sola vez (CA1) aunque dos procesos lo intenten a la vez, y
 * la fila deja registrado si el envío falló (CA4).
 */
@Entity({ tableName: 'arrival_messages' })
@Unique({ properties: ['reservation', 'type'] })
export class ArrivalMessage extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => Reservation, { deleteRule: 'cascade' })
  reservation!: Reservation;

  @Enum(() => ArrivalMessageType)
  type!: ArrivalMessageType;

  /** Chat de Telegram al que se mandó el mensaje. */
  @Property({ type: 'varchar' })
  telegramUserId!: string;

  @Enum(() => ArrivalMessageStatus)
  status: ArrivalMessageStatus & Opt = ArrivalMessageStatus.PENDING;

  @Property({ type: 'datetime', nullable: true })
  sentAt?: Date;

  /** Lo que respondió Telegram cuando el envío falló. */
  @Property({ type: 'text', nullable: true })
  failureReason?: string;
}
