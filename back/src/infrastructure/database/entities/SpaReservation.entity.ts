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
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

/**
 * Solicitud de un huésped para un servicio interno (US-17). Es una intención que recepción
 * confirma o rechaza desde el panel; no reserva cupo por sí misma.
 *
 * Fecha y hora se guardan como 'YYYY-MM-DD' y 'HH:mm' de pared del hotel (misma convención que
 * SupportHours). El nombre del servicio y del huésped son una foto del momento del pedido, para
 * que el panel no cambie si después se renombra el servicio.
 */
@Entity({ tableName: 'spa_reservations' })
export class SpaReservation extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Enum(() => SpaReservationStatus)
  status: SpaReservationStatus & Opt = SpaReservationStatus.PENDING;

  @Property({ type: 'varchar' })
  telegramUserId!: string;

  /** La reserva de habitación que habilita al huésped a pedir el turno. */
  @ManyToOne(() => Reservation)
  roomReservation!: Reservation;

  @ManyToOne(() => SpaService)
  spaService!: SpaService;

  @Property({ type: 'varchar', length: 120 })
  serviceName!: string;

  @Property({ type: 'varchar' })
  guestFullName!: string;

  @Property({ type: 'varchar', length: 10 })
  requestedDate!: string;

  @Property({ type: 'varchar', length: 5 })
  requestedTime!: string;
}
