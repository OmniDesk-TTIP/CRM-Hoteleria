import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { Account, PaymentMethod } from './Account.entity';
import { CustomBaseEntity } from './CustomBase.entity';
import { User } from './User.entity';

export enum AccountEntryType {
  CHARGE = 'CHARGE',
  PAYMENT = 'PAYMENT',
  CHARGE_REVERSAL = 'CHARGE_REVERSAL',
  PAYMENT_REVERSAL = 'PAYMENT_REVERSAL',
  REFUND = 'REFUND',
}

export enum AccountEntryOrigin {
  ROOM_SERVICE = 'ROOM_SERVICE',
  SPA = 'SPA',
  RESTAURANT = 'RESTAURANT',
  RECEPTION = 'RECEPTION',
}

/**
 * Movimiento del libro de una cuenta corriente (US-26). Es inmutable: un error se corrige con
 * una anulación que apunta al original. El OneToOne de `reverses` deja esa FK única, así que un
 * movimiento no se puede anular dos veces ni con dos pedidos simultáneos.
 */
@Entity({ tableName: 'account_entries' })
@Index({ properties: ['account', 'registeredAt'] })
export class AccountEntry extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => Account)
  account!: Account;

  @Enum(() => AccountEntryType)
  type!: AccountEntryType;

  /** Siempre positivo: el tipo dice si suma o resta al saldo. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  @Check({ expression: 'amount > 0' })
  amount!: number;

  @Property({ type: 'varchar', length: 200 })
  description!: string;

  @Enum(() => AccountEntryOrigin)
  origin!: AccountEntryOrigin;

  /** Pedido de room service, turno de spa, reserva del restó o reserva de habitación que lo generó. */
  @Property({ type: 'uuid', nullable: true })
  sourceId?: string | null;

  /** Con qué se cobró o se devolvió. Solo en pagos, reintegros y anulaciones de pagos. */
  @Enum({ items: () => PaymentMethod, nullable: true })
  paymentMethod?: PaymentMethod | null;

  /** Número de operación, de cupón, etc. Opcional, solo en pagos. */
  @Property({ type: 'varchar', length: 100, nullable: true })
  reference?: string | null;

  /**
   * Clave que manda el panel por cada pago o reintegro confirmado. Única: si el pedido se
   * reintenta, no se registra un segundo movimiento.
   */
  @Property({ type: 'uuid', nullable: true, unique: true })
  operationId?: string | null;

  @OneToOne(() => AccountEntry, {
    owner: true,
    nullable: true,
    deleteRule: 'no action',
  })
  reverses?: AccountEntry | null;

  @Property({ type: 'datetime', columnType: 'timestamp(6)' })
  registeredAt!: Date;

  /**
   * Null cuando lo registró Chamber (el bot). Sin `set null`: borrar un usuario no puede hacer
   * pasar sus movimientos como del bot.
   */
  @ManyToOne(() => User, { nullable: true, deleteRule: 'no action' })
  registeredBy?: User | null;
}
