import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { RoomCategoryPhoto } from '../../infrastructure/database/entities/RoomCategoryPhoto.entity';
import { PhotoContent } from '../../common/photo.util';

// `data` es lazy: los listados nunca traen los bytes, solo findContent.
@Injectable()
export class RoomPhotoRepository {
  constructor(private readonly em: EntityManager) {}

  findCategoryById(id: string): Promise<RoomCategory | null> {
    return this.em.findOne(RoomCategory, { id });
  }

  findByCategory(categoryId: string): Promise<RoomCategoryPhoto[]> {
    return this.findByCategories([categoryId]);
  }

  async findByCategories(categoryIds: string[]): Promise<RoomCategoryPhoto[]> {
    if (categoryIds.length === 0) return [];
    return this.em.find(
      RoomCategoryPhoto,
      { category: { $in: categoryIds } },
      { orderBy: { position: 'asc', createdAt: 'asc' } },
    );
  }

  countByCategory(categoryId: string): Promise<number> {
    return this.em.count(RoomCategoryPhoto, { category: categoryId });
  }

  async findContent(id: string): Promise<PhotoContent | null> {
    const entity = await this.em.findOne(
      RoomCategoryPhoto,
      { id },
      { populate: ['data'] },
    );
    return entity ? { data: entity.data, mimeType: entity.mimeType } : null;
  }

  async insert(
    category: RoomCategory,
    data: Buffer,
    mimeType: string,
  ): Promise<RoomCategoryPhoto> {
    const [last] = await this.em.find(
      RoomCategoryPhoto,
      { category },
      { orderBy: { position: 'desc' }, limit: 1 },
    );
    const entity = this.em.create(RoomCategoryPhoto, {
      category,
      data,
      mimeType,
      sizeBytes: data.length,
      position: last ? last.position + 1 : 0,
    });
    this.em.persist(entity);
    await this.em.flush();
    return entity;
  }

  async updatePositions(ids: string[]): Promise<void> {
    await this.em.transactional(async (em) => {
      for (const [position, id] of ids.entries()) {
        await em.nativeUpdate(RoomCategoryPhoto, { id }, { position });
      }
    });
  }

  async delete(categoryId: string, id: string): Promise<boolean> {
    const affected = await this.em.nativeDelete(RoomCategoryPhoto, {
      id,
      category: categoryId,
    });
    return affected > 0;
  }
}
