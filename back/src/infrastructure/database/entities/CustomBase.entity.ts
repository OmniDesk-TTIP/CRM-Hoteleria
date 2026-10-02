import { Opt } from '@mikro-orm/core';
import { Entity, Property } from '@mikro-orm/decorators/legacy';

@Entity({ abstract: true })
export abstract class CustomBaseEntity {
  @Property({
    type: 'datetime',
    columnType: 'timestamp(6)',
    defaultRaw: `now()`,
    fieldName: 'created_at',
  })
  createdAt!: Date & Opt;

  @Property({
    type: 'datetime',
    columnType: 'timestamp(6)',
    nullable: true,
    fieldName: 'updated_at',
    onUpdate: () => new Date(),
  })
  updatedAt!: Date & Opt;
}
