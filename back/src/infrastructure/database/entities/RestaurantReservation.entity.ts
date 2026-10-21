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
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  REJECTED = 'REJECTED',
}

@Entity({ tableName: 'restaurant_reservations' })
export class RestaurantReservation extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Enum(() => RestaurantReservationStatus)
  status: RestaurantReservationStatus & Opt =
    RestaurantReservationStatus.PENDING;

  @Property({ type: 'varchar' })
  telegramUserId!: string;

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

  @Property({ type: 'varchar', length: 300, nullable: true })
  notes?: string;
}
