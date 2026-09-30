import { Collection } from '@mikro-orm/core'; 
import { Entity, PrimaryKey, Property, OneToMany, ManyToOne, Enum } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import type { RoomCategory } from './RoomCategory.entity';
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

  @ManyToOne(() => require('./RoomCategory.entity').RoomCategory)
  category!: RoomCategory;

  @Property({ type: 'varchar', unique: true })
  roomNumber!: string;

  @Enum(() => RoomStatus)
  status: RoomStatus = RoomStatus.ACTIVE;

}