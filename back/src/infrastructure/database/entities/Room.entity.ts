import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Enum,
} from '@mikro-orm/decorators/legacy';
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

  // require() a propósito: evita el import circular con RoomCategory.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  @ManyToOne(() => require('./RoomCategory.entity').RoomCategory)
  category!: RoomCategory;

  @Property({ type: 'varchar', unique: true })
  roomNumber!: string;

  @Enum(() => RoomStatus)
  status: RoomStatus = RoomStatus.ACTIVE;
}
