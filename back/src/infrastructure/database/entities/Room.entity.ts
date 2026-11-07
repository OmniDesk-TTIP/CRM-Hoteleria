import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Enum,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { RoomCategory } from './RoomCategory.entity';
import { CustomBaseEntity } from './CustomBase.entity';

export enum RoomStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  INACTIVE = 'INACTIVE',
}

@Entity({ tableName: 'rooms' })
export class Room extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => RoomCategory)
  category!: RoomCategory;

  @Property({ type: 'varchar', unique: true })
  roomNumber!: string;

  @Enum(() => RoomStatus)
  status: RoomStatus = RoomStatus.ACTIVE;
}
