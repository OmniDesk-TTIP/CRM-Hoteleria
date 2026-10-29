import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';
import { Reservation } from './Reservation.entity';

export enum RoomServiceOrderStatus {
  /** Borrador: Chamber le mostró el resumen y espera que el huésped toque "Confirmar pedido". */
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  RECEIVED = 'RECEIVED',
  IN_PREPARATION = 'IN_PREPARATION',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum RoomServicePaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
}

export interface RoomServiceOrderItem {
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  notes: string | null;
}

/**
 * Pedido de room service hecho por el chat (US-24). Los platos, el nombre del huésped y el número
 * de habitación son una foto del momento del pedido, para que el panel no cambie si después se
 * reprecia un plato o se mueve la reserva. El total queda asociado a la reserva del huésped.
 */
@Entity({ tableName: 'room_service_orders' })
@Index({ properties: ['status'] })
export class RoomServiceOrder extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Enum(() => RoomServiceOrderStatus)
  status: RoomServiceOrderStatus & Opt =
    RoomServiceOrderStatus.PENDING_CONFIRMATION;

  @Property({ type: 'varchar' })
  telegramUserId!: string;

  @ManyToOne(() => Reservation)
  roomReservation!: Reservation;

  @Property({ type: 'varchar' })
  roomNumber!: string;

  @Property({ type: 'varchar' })
  guestFullName!: string;

  @Property({ type: 'json' })
  items!: RoomServiceOrderItem[];

  @Property({ type: 'text', nullable: true })
  notes?: string | null;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  total!: number;

  @Enum(() => RoomServicePaymentStatus)
  paymentStatus: RoomServicePaymentStatus & Opt =
    RoomServicePaymentStatus.PENDING;

  /** Cuándo el huésped confirmó el pedido; null mientras es borrador. */
  @Property({ type: 'datetime', nullable: true })
  confirmedAt?: Date | null;

  @Property({ type: 'varchar', nullable: true })
  mpPreferenceId?: string;

  @Property({ type: 'varchar', nullable: true })
  mpInitPoint?: string;

  @Property({ type: 'varchar', nullable: true })
  mpPaymentId?: string;
}
