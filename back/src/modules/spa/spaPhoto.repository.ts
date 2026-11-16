import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { SpaPhoto } from '../../infrastructure/database/entities/SpaPhoto.entity';
import { SpaPhotoModel } from './model/spaPhoto.model';
import { PhotoContent } from '../../common/photo.util';

// `data` es lazy: los listados nunca traen los bytes, solo findContent.
@Injectable()
export class SpaPhotoRepository {
  constructor(private readonly em: EntityManager) {}

  async findAll(): Promise<SpaPhotoModel[]> {
    const entities = await this.em.find(
      SpaPhoto,
      {},
      { orderBy: { position: 'asc', createdAt: 'asc' } },
    );
    return entities.map((entity) => this.toModel(entity));
  }

  count(): Promise<number> {
    return this.em.count(SpaPhoto, {});
  }

  async findContent(id: string): Promise<PhotoContent | null> {
    const entity = await this.em.findOne(
      SpaPhoto,
      { id },
      { populate: ['data'] },
    );
    return entity ? { data: entity.data, mimeType: entity.mimeType } : null;
  }

  async insert(data: Buffer, mimeType: string): Promise<SpaPhotoModel> {
    // find con limit y no findOne: MikroORM no acepta findOne con el filtro vacío.
    const [last] = await this.em.find(
      SpaPhoto,
      {},
      { orderBy: { position: 'desc' }, limit: 1 },
    );
    const entity = this.em.create(SpaPhoto, {
      data,
      mimeType,
      sizeBytes: data.length,
      position: last ? last.position + 1 : 0,
    });
    this.em.persist(entity);
    await this.em.flush();
    return this.toModel(entity);
  }

  async updatePositions(ids: string[]): Promise<void> {
    await this.em.transactional(async (em) => {
      for (const [position, id] of ids.entries()) {
        await em.nativeUpdate(SpaPhoto, { id }, { position });
      }
    });
  }

  async delete(id: string): Promise<boolean> {
    const affected = await this.em.nativeDelete(SpaPhoto, { id });
    return affected > 0;
  }

  private toModel(entity: SpaPhoto): SpaPhotoModel {
    return new SpaPhotoModel({
      id: entity.id,
      mimeType: entity.mimeType,
      sizeBytes: entity.sizeBytes,
      position: entity.position,
    });
  }
}
