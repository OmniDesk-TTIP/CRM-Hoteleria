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
import { SpaService } from './SpaService.entity';

export enum SpaReservationStatus {
  /** Turno de un huésped: espera que recepción lo confirme o rechace. */
  PENDING = 'PENDING',
  /** Turno de un cliente externo: guardado hasta que se acredite el pago (o venza). */
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
  /** El pago no llegó a tiempo y el lugar se liberó. */
  CANCELLED = 'CANCELLED',
}

export enum SpaReservationClientType {
  /** Hospedado en el hotel: el spa es sin cargo. */
  GUEST = 'GUEST',
  /** Viene solo al spa: paga el servicio al reservar. */
  EXTERNAL = 'EXTERNAL',
}

/**
 * Turno de spa pedido por el chat (US-17). Lo piden huéspedes (sin cargo, recepción confirma) y
 * clientes externos (pagan por Mercado Pago y se confirma solo al acreditarse). Los turnos en
 * PENDING, PENDING_PAYMENT y CONFIRMED ocupan un lugar de la capacidad del servicio.
 *
 * Fecha y hora se guardan como 'YYYY-MM-DD' y 'HH:mm' de pared del hotel (misma convención que
 * SupportHours). El nombre del servicio, el del cliente y el monto son una foto del momento del
 * pedido, para que el panel no cambie si después se renombra o se reprecia el servicio.
 */
@Entity({ tableName: 'spa_reservations' })
export class SpaReservation extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Enum(() => SpaReservationStatus)
  status: SpaReservationStatus & Opt = SpaReservationStatus.PENDING;

  @Property({ type: 'varchar' })
  telegramUserId!: string;

  @Enum(() => SpaReservationClientType)
  clientType: SpaReservationClientType & Opt = SpaReservationClientType.GUEST;

  /** La reserva de habitación que habilita al huésped; los clientes externos no tienen. */
  @ManyToOne(() => Reservation, { nullable: true })
  roomReservation?: Reservation;

  @ManyToOne(() => SpaService)
  spaService!: SpaService;

  @Property({ type: 'varchar', length: 120 })
  serviceName!: string;

  @Property({ type: 'varchar' })
  guestFullName!: string;

  /** Solo los clientes externos informan DNI (lo pide Mercado Pago). */
  @Property({ type: 'varchar', nullable: true })
  guestDni?: string;

  @Property({ type: 'varchar', length: 10 })
  requestedDate!: string;

  @Property({ type: 'varchar', length: 5 })
  requestedTime!: string;

  /** Lo que se cobra: 0 para huéspedes, el precio del servicio para externos. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  amount: number & Opt = 0;

  @Property({ type: 'varchar', nullable: true })
  mpPreferenceId?: string;

  @Property({ type: 'varchar', nullable: true })
  mpInitPoint?: string;

  @Property({ type: 'varchar', nullable: true })
  mpPaymentId?: string;
}
