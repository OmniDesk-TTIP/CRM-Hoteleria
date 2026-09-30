import { Opt } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

/**
 * Horario de atención de la recepción (CA5), una fila por día de la semana.
 *
 * Las horas se guardan como 'HH:mm' literal y no como timestamp: son horas de pared del hotel,
 * no instantes. La zona horaria con la que se interpretan vive en SUPPORT_TIMEZONE, porque la
 * base corre en UTC (ver timezone: 'UTC' en database.config.ts).
 */
@Entity({ tableName: 'support_hours' })
export class SupportHours extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  /** 0 = domingo … 6 = sábado, igual que Date.getDay(). */
  @Property({ type: 'smallint' })
  @Unique()
  weekday!: number;

  @Property({ type: 'boolean' })
  isClosed: boolean & Opt = false;

  @Property({ type: 'varchar', length: 5 })
  opensAt: string & Opt = '09:00';

  @Property({ type: 'varchar', length: 5 })
  closesAt: string & Opt = '21:00';
}
