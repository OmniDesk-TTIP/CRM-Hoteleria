import { Opt } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export interface CancellationTier {
  minDaysBeforeCheckIn: number;
  refundPercentage: number;
}

@Entity({ tableName: 'cancellation_policies' })
export class CancellationPolicy extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar', length: 120, unique: true })
  name!: string;

  @Property({ type: 'json' })
  tiers!: CancellationTier[];

  @Property({ type: 'boolean' })
  active: boolean & Opt = false;
}
