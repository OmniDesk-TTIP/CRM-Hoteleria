import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';
import { RoomCategory } from './RoomCategory.entity';

// Las fotos son del tipo de habitación y no de cada habitación física: la landing muestra
// "Doble" una sola vez, con su galería.
@Entity({ tableName: 'room_category_photos' })
export class RoomCategoryPhoto extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Index()
  @ManyToOne(() => RoomCategory, { deleteRule: 'cascade' })
  category!: RoomCategory;

  @Property({ type: 'blob', lazy: true })
  data!: Buffer;

  @Property({ type: 'varchar', length: 60 })
  mimeType!: string;

  @Property({ type: 'int' })
  sizeBytes!: number;

  @Property({ type: 'int' })
  position: number & Opt = 0;
}
