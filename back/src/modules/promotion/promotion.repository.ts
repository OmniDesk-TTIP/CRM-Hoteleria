import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/core';
import { Promotion } from '../../infrastructure/database/entities/Promotion.entity';
import { PromotionModel, PromotionStatus } from './promotion.model';

interface PromotionFilters {
  status?: PromotionStatus;
  today: string;
  page: number;
  pageSize: number;
}

/** Espejo en SQL de `PromotionModel.getStatus`: las fechas son YYYY-MM-DD y se comparan como texto. */
function statusFilter(
  status: PromotionStatus | undefined,
  today: string,
): FilterQuery<Promotion> {
  switch (status) {
    case PromotionStatus.DISABLED:
      return { enabled: false };
    case PromotionStatus.SCHEDULED:
      return { enabled: true, startDate: { $gt: today } };
    case PromotionStatus.EXPIRED:
      return { enabled: true, endDate: { $lt: today } };
    case PromotionStatus.ACTIVE:
      return {
        enabled: true,
        startDate: { $lte: today },
        endDate: { $gte: today },
      };
    default:
      return {};
  }
}

@Injectable()
export class PromotionRepository {
  constructor(private readonly em: EntityManager) {}

  async findPage(
    filters: PromotionFilters,
  ): Promise<{ items: PromotionModel[]; total: number }> {
    const [entities, total] = await this.em.findAndCount(
      Promotion,
      statusFilter(filters.status, filters.today),
      {
        orderBy: { createdAt: 'desc', id: 'desc' },
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize,
      },
    );
    return { items: entities.map((entity) => this.toModel(entity)), total };
  }

  /** A igual descuento, gana la más antigua: el criterio no cambia entre cotizar y confirmar. */
  async findActive(today: string): Promise<PromotionModel[]> {
    const entities = await this.em.find(
      Promotion,
      statusFilter(PromotionStatus.ACTIVE, today),
      {
        orderBy: { discountPercentage: 'desc', createdAt: 'asc', id: 'asc' },
        refresh: true,
      },
    );
    return entities.map((entity) => this.toModel(entity));
  }

  async findById(id: string): Promise<PromotionModel | null> {
    const entity = await this.em.findOne(Promotion, { id });
    return entity ? this.toModel(entity) : null;
  }

  async insert(model: PromotionModel): Promise<PromotionModel> {
    const entity = this.em.create(Promotion, {
      id: model.id,
      title: model.title,
      description: model.description,
      discountPercentage: model.discountPercentage,
      startDate: model.startDate,
      endDate: model.endDate,
      target: model.target,
      minNights: model.minNights,
      enabled: model.enabled,
    });
    await this.em.persist(entity).flush();
    return this.toModel(entity);
  }

  async update(model: PromotionModel): Promise<void> {
    const entity = await this.em.findOneOrFail(Promotion, { id: model.id });
    entity.title = model.title;
    entity.description = model.description;
    entity.discountPercentage = model.discountPercentage;
    entity.startDate = model.startDate;
    entity.endDate = model.endDate;
    entity.target = model.target;
    entity.minNights = model.minNights;
    entity.enabled = model.enabled;
    await this.em.flush();
  }

  /** Las reservas conservan la foto de lo que se les aplicó: la FK queda en null. */
  async delete(id: string): Promise<void> {
    await this.em.nativeDelete(Promotion, { id });
  }

  private toModel(entity: Promotion): PromotionModel {
    return new PromotionModel({
      id: entity.id,
      title: entity.title,
      description: entity.description,
      discountPercentage: entity.discountPercentage,
      startDate: entity.startDate,
      endDate: entity.endDate,
      target: entity.target,
      minNights: entity.minNights ?? null,
      enabled: entity.enabled,
      createdAt: entity.createdAt,
    });
  }
}
