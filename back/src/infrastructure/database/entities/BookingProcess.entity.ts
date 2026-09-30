import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export enum BookingProcessStep {
  AWAITING_CHECKIN = 'AWAITING_CHECKIN',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING_CONFIRMATION = 'PENDING_CONFIRMATION',
  COMPLETED = 'COMPLETED',
}

@Entity({ tableName: 'booking_processes' })
export class BookingProcess extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar' })
  telegramUserId!: string;

  @Enum(() => BookingProcessStep)
  step: BookingProcessStep = BookingProcessStep.AWAITING_CHECKIN;

  @Property({ type: 'varchar', nullable: true })
  checkIn?: string;

  @Property({ type: 'varchar', nullable: true })
  checkOut?: string;

  @Property({ type: 'integer', nullable: true })
  capacity?: number;
}