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

/** Franja de atención del restó (por ejemplo almuerzo o cena), en hora de pared del hotel. */
export interface RestaurantShift {
  /** HH:mm */
  opensAt: string;
  /** HH:mm */
  closesAt: string;
}

/**
 * Información general del restaurante (US-17). Hay una sola fila: el hotel tiene un solo restó.
 * Mientras no exista, el restó se considera deshabilitado y Chamber no lo ofrece.
 */
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

  /** Mesas de más personas no se piden por el chat: se derivan a recepción. */
  @Property({ type: 'int' })
  maxPartySize: number & Opt = 10;
}
