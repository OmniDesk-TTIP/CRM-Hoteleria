import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export enum MenuItemStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity({ tableName: 'restaurant_menu_items' })
export class RestaurantMenuItem extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar', length: 120, unique: true })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'varchar', length: 60 })
  category!: string;

  @Property({ type: 'decimal', precision: 12, scale: 2 })
  price!: number;

  @Enum(() => MenuItemStatus)
  status: MenuItemStatus & Opt = MenuItemStatus.ACTIVE;

  /** US-24: el plato también se puede pedir por room service. */
  @Property({ type: 'boolean' })
  availableForRoomService: boolean & Opt = false;
}
