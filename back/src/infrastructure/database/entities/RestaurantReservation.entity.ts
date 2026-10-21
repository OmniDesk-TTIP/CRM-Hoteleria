import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';
import { Reservation } from './Reservation.entity';

export enum RestaurantReservationStatus {
  /** Espera que recepción la confirme o la rechace. */
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

/**
 * Pedido de mesa en el restó hecho por el chat (US-17 CA5). Solo lo piden huéspedes con reserva
 * confirmada o alojados (CA2), y recepción lo confirma o rechaza desde el panel.
 *
 * Fecha y hora se guardan como 'YYYY-MM-DD' y 'HH:mm' de pared del hotel (misma convención que
 * los turnos de spa). El nombre del huésped es una foto del momento del pedido.
 */
@Entity({ tableName: 'restaurant_reservations' })
export class RestaurantReservation extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Enum(() => RestaurantReservationStatus)
  status: RestaurantReservationStatus & Opt =
    RestaurantReservationStatus.PENDING;

  @Property({ type: 'varchar' })
  telegramUserId!: string;

  /** La reserva de habitación que habilita al huésped. */
  @ManyToOne(() => Reservation)
  roomReservation!: Reservation;

  @Property({ type: 'varchar' })
  guestFullName!: string;

  @Property({ type: 'varchar', length: 10 })
  requestedDate!: string;

  @Property({ type: 'varchar', length: 5 })
  requestedTime!: string;

  @Property({ type: 'int' })
  partySize!: number;

  /** Pedido especial que el huésped mencionó (celíacos, cumpleaños, silla para bebé…). */
  @Property({ type: 'varchar', length: 300, nullable: true })
  notes?: string;
}
