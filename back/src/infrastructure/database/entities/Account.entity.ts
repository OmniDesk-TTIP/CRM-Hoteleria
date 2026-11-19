import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  ManyToOne,
  OneToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';
import { Reservation } from './Reservation.entity';
import { User } from './User.entity';

export enum AccountStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
  MERCADO_PAGO = 'MERCADO_PAGO',
}

/**
 * Cuenta corriente de una reserva (US-26). Se abre cuando recepción registra el pago del resto
 * de la estadía, así que desde ese momento solo junta consumos. El OneToOne deja la FK única:
 * una reserva tiene una sola cuenta aunque dos usuarios la abran a la vez.
 *
 * El saldo no se guarda: sale de los movimientos (AccountEntry).
 */
@Entity({ tableName: 'accounts' })
export class Account extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  // Sin cascade: borrar una reserva no puede llevarse sus movimientos de plata.
  @OneToOne(() => Reservation, { owner: true })
  reservation!: Reservation;

  @Enum(() => AccountStatus)
  status: AccountStatus & Opt = AccountStatus.OPEN;

  /** Lo que se cobró del resto de la estadía (total − seña) al abrir la cuenta. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  stayBalanceAmount!: number;

  @Enum(() => PaymentMethod)
  stayBalancePaymentMethod!: PaymentMethod;

  @ManyToOne(() => User)
  openedBy!: User;

  @Property({ type: 'datetime', columnType: 'timestamp(6)' })
  openedAt!: Date;

  @Property({ type: 'datetime', columnType: 'timestamp(6)', nullable: true })
  closedAt?: Date | null;
}
