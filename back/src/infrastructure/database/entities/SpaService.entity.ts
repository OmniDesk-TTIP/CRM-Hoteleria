import { Opt } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export enum SpaServiceStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

@Entity({ tableName: 'spa_services' })
export class SpaService extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar', length: 120, unique: true })
  name!: string;

  @Property({ type: 'text' })
  description!: string;

  @Property({ type: 'int' })
  durationMinutes!: number;

  /** Precio para clientes externos; los huéspedes no pagan. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  price!: number;

  /** Cuántos turnos pueden estar en curso a la vez (cabinas o profesionales disponibles). */
  @Property({ type: 'int' })
  capacity: number & Opt = 1;

  @Enum(() => SpaServiceStatus)
  status: SpaServiceStatus & Opt = SpaServiceStatus.ACTIVE;

  @Property({ type: 'json' })
  availableWeekdays!: number[];

  @Property({ type: 'varchar', length: 5 })
  opensAt!: string;

  @Property({ type: 'varchar', length: 5 })
  closesAt!: string;
}
