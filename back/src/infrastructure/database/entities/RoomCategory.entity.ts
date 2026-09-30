import { Collection } from '@mikro-orm/core'; 
import { Entity, PrimaryKey, Property, OneToMany, ManyToOne, Enum } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import type { Room } from './Room.entity';
import { CustomBaseEntity } from './CustomBase.entity';

@Entity({ tableName: 'room_categories' })
export class RoomCategory extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar' })
  name!: string;

  @Property({ type: 'integer' })
  capacity!: number;

  @Property({ type: 'decimal', precision: 10, scale: 2 })
  basePrice!: number;

  @OneToMany(() => require('./Room.entity').Room, 'category')
  rooms = new Collection<Room>(this);
}