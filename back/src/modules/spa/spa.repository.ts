import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import {
  SpaService,
  SpaServiceStatus,
} from '../../infrastructure/database/entities/SpaService.entity';
import { SpaServiceModel } from './model/spa.model';

/** Único lugar que conoce a la vez la entidad del ORM y el modelo de dominio. */
@Injectable()
export class SpaRepository {
  constructor(private readonly em: EntityManager) {}

  async findAll(): Promise<SpaServiceModel[]> {
    const entities = await this.em.find(
      SpaService,
      {},
      { orderBy: { name: 'asc' } },
    );
    return entities.map((entity) => this.toModel(entity));
  }

  async findActive(): Promise<SpaServiceModel[]> {
    const entities = await this.em.find(
      SpaService,
      { status: SpaServiceStatus.ACTIVE },
      { orderBy: { name: 'asc' } },
    );
    return entities.map((entity) => this.toModel(entity));
  }

  async findById(id: string): Promise<SpaServiceModel | null> {
    const entity = await this.em.findOne(SpaService, { id });
    return entity ? this.toModel(entity) : null;
  }

  async findByName(
    name: string,
    excludeId?: string,
  ): Promise<SpaServiceModel | null> {
    const entity = await this.em.findOne(SpaService, {
      name: { $ilike: name },
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    });
    return entity ? this.toModel(entity) : null;
  }

  async insert(model: SpaServiceModel): Promise<void> {
    this.em.persist(this.em.create(SpaService, { ...model }));
    await this.em.flush();
  }

  async update(model: SpaServiceModel): Promise<void> {
    const entity = await this.em.findOneOrFail(SpaService, { id: model.id });
    // Asignación directa y no em.assign(): Postgres devuelve `decimal` como string y assign()
    // valida el tipo contra el valor cargado, así que rechazaría el price numérico.
    entity.name = model.name;
    entity.description = model.description;
    entity.durationMinutes = model.durationMinutes;
    entity.price = model.price;
    entity.status = model.status;
    entity.availableWeekdays = model.availableWeekdays;
    entity.opensAt = model.opensAt;
    entity.closesAt = model.closesAt;
    await this.em.flush();
  }

  private toModel(entity: SpaService): SpaServiceModel {
    return new SpaServiceModel({
      id: entity.id,
      name: entity.name,
      description: entity.description,
      durationMinutes: entity.durationMinutes,
      // decimal llega como string desde pg.
      price: Number(entity.price),
      status: entity.status,
      availableWeekdays: entity.availableWeekdays,
      opensAt: entity.opensAt,
      closesAt: entity.closesAt,
    });
  }
}
