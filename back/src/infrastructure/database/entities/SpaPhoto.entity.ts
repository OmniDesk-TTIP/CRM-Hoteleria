import { Opt } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

// Galería del espacio del spa (sala, sauna, cabinas), no de cada servicio.
@Entity({ tableName: 'spa_photos' })
export class SpaPhoto extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'blob', lazy: true })
  data!: Buffer;

  @Property({ type: 'varchar', length: 60 })
  mimeType!: string;

  @Property({ type: 'int' })
  sizeBytes!: number;

  @Property({ type: 'int' })
  position: number & Opt = 0;
}
