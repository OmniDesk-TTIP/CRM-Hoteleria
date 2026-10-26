import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export enum RestaurantStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export interface RestaurantShift {
  opensAt: string;
  closesAt: string;
}

@Entity({ tableName: 'restaurant_settings' })
export class RestaurantSettings extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Enum(() => RestaurantStatus)
  status: RestaurantStatus & Opt = RestaurantStatus.ACTIVE;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json' })
  availableWeekdays!: number[];

  @Property({ type: 'json' })
  shifts!: RestaurantShift[];

  @Property({ type: 'int' })
  maxPartySize: number & Opt = 10;
}
