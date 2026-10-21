import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { RestaurantPhoto } from '../../infrastructure/database/entities/RestaurantPhoto.entity';
import { RestaurantPhotoModel } from './model/restaurantPhoto.model';

export interface PhotoContent {
  data: Buffer;
  mimeType: string;
}

@Injectable()
export class RestaurantPhotoRepository {
  constructor(private readonly em: EntityManager) {}

  /** La galería en orden, sin los bytes de las imágenes (`data` es lazy). */
  async findAll(): Promise<RestaurantPhotoModel[]> {
    const entities = await this.em.find(
      RestaurantPhoto,
      {},
      { orderBy: { position: 'asc', createdAt: 'asc' } },
    );
    return entities.map((entity) => this.toModel(entity));
  }

  count(): Promise<number> {
    return this.em.count(RestaurantPhoto, {});
  }

  async findContent(id: string): Promise<PhotoContent | null> {
    const entity = await this.em.findOne(
      RestaurantPhoto,
      { id },
      { populate: ['data'] },
    );
    return entity ? { data: entity.data, mimeType: entity.mimeType } : null;
  }

  /** Agrega la foto al final de la galería. */
  async insert(data: Buffer, mimeType: string): Promise<RestaurantPhotoModel> {
    // find con limit y no findOne: MikroORM no acepta findOne con el filtro vacío.
    const [last] = await this.em.find(
      RestaurantPhoto,
      {},
      { orderBy: { position: 'desc' }, limit: 1 },
    );
    const entity = this.em.create(RestaurantPhoto, {
      data,
      mimeType,
      sizeBytes: data.length,
      position: last ? last.position + 1 : 0,
    });
    this.em.persist(entity);
    await this.em.flush();
    return this.toModel(entity);
  }

  /** Guarda el orden: la foto de `ids[0]` pasa a ser la primera. */
  async updatePositions(ids: string[]): Promise<void> {
    await this.em.transactional(async (em) => {
      for (const [position, id] of ids.entries()) {
        await em.nativeUpdate(RestaurantPhoto, { id }, { position });
      }
    });
  }

  /** Devuelve false si la foto no existía. */
  async delete(id: string): Promise<boolean> {
    const affected = await this.em.nativeDelete(RestaurantPhoto, { id });
    return affected > 0;
  }

  private toModel(entity: RestaurantPhoto): RestaurantPhotoModel {
    return new RestaurantPhotoModel({
      id: entity.id,
      mimeType: entity.mimeType,
      sizeBytes: entity.sizeBytes,
      position: entity.position,
    });
  }
}
