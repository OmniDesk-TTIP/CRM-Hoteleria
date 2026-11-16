import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

/** Qué se puede comprar con descuento. Son lo que el hotel cotiza y cobra por Chamber. */
export enum PromotionTarget {
  ROOMS = 'ROOMS',
  SPA = 'SPA',
}

/**
 * Promoción del hotel (US-21). El estado (programada, vigente, vencida o deshabilitada) no se
 * guarda: sale de `enabled` y las fechas, así vence sola sin ningún proceso de por medio.
 *
 * Las fechas son 'YYYY-MM-DD' de pared del hotel (misma convención que SpaReservation).
 */
@Entity({ tableName: 'promotions' })
export class Promotion extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar', length: 100 })
  title!: string;

  @Property({ type: 'text' })
  description!: string;

  @Property({ type: 'integer' })
  discountPercentage!: number;

  @Property({ type: 'varchar', length: 10 })
  startDate!: string;

  @Property({ type: 'varchar', length: 10 })
  endDate!: string;

  @Enum(() => PromotionTarget)
  target!: PromotionTarget;

  /** Condición opcional: solo tiene sentido en habitaciones. */
  @Property({ type: 'integer', nullable: true })
  minNights?: number | null;

  @Property({ type: 'boolean' })
  enabled: boolean & Opt = true;
}
