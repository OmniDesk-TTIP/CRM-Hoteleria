import { Opt } from '@mikro-orm/core';
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Enum,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { Room } from './Room.entity';
import { CustomBaseEntity } from './CustomBase.entity';

export enum ReservationStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

/** estado de la devolucion de la seña que genera una cancelacion con reintegro*/
export enum RefundStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

/** de donde salio la reserva si del bot o carga manual desde el panel. */
export enum ReservationOrigin {
  BOT = 'BOT',
  MANUAL = 'MANUAL',
}

@Entity({ tableName: 'reservations' })
export class Reservation extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => Room)
  room!: Room;

  @Property({ type: 'varchar', nullable: true })
  telegramUserId?: string;

  @Property({ type: 'date' })
  checkIn!: Date;

  @Property({ type: 'date' })
  checkOut!: Date;

  @Enum(() => ReservationStatus)
  status: ReservationStatus = ReservationStatus.PENDING_PAYMENT;

  @Enum(() => ReservationOrigin)
  origin: ReservationOrigin & Opt = ReservationOrigin.BOT;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  totalAmount!: number;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  depositAmount!: number;

  @Property({ type: 'varchar' })
  guestFullName!: string;

  @Property({ type: 'varchar' })
  guestDni!: string;

  @Property({ type: 'varchar', nullable: true })
  mpPreferenceId?: string;

  @Property({ type: 'varchar', nullable: true })
  mpInitPoint?: string;

  @Property({ type: 'varchar', nullable: true })
  mpPaymentId?: string;

  @Property({
    type: 'datetime',
    columnType: 'timestamp(6)',
    nullable: true,
  })
  cancelledAt?: Date;

  @Property({ type: 'varchar', length: 120, nullable: true })
  cancellationPolicyName?: string;

  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  refundPercentage?: number;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  refundAmount?: number;

  @Enum({ items: () => RefundStatus, nullable: true })
  refundStatus?: RefundStatus;

  @Property({ type: 'datetime', columnType: 'timestamp(6)', nullable: true })
  refundedAt?: Date;
}