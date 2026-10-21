import { Opt } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

/**
 * Foto de la galería del restó (US-17 CA6). La imagen se guarda en la base y no en disco: el
 * back puede correr en un contenedor sin volumen persistente. `data` es lazy para que listar la
 * galería no traiga los bytes de todas las fotos.
 */
@Entity({ tableName: 'restaurant_photos' })
export class RestaurantPhoto extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'blob', lazy: true })
  data!: Buffer;

  @Property({ type: 'varchar', length: 60 })
  mimeType!: string;

  @Property({ type: 'int' })
  sizeBytes!: number;

  /** Orden en la galería: 0 es la primera. */
  @Property({ type: 'int' })
  position: number & Opt = 0;
}
