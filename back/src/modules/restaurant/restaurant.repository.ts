import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { RestaurantSettings } from '../../infrastructure/database/entities/RestaurantSettings.entity';
import {
  MenuItemStatus,
  RestaurantMenuItem,
} from '../../infrastructure/database/entities/RestaurantMenuItem.entity';
import {
  MenuItemModel,
  RestaurantSettingsModel,
} from './model/restaurant.model';

@Injectable()
export class RestaurantRepository {
  constructor(private readonly em: EntityManager) {}

  // ───────── Información ─────────

  async findSettings(): Promise<RestaurantSettingsModel | null> {
    const [entity] = await this.em.find(
      RestaurantSettings,
      {},
      { orderBy: { createdAt: 'asc' }, limit: 1 },
    );
    return entity ? this.toSettingsModel(entity) : null;
  }

  async saveSettings(model: RestaurantSettingsModel): Promise<void> {
    const [entity] = await this.em.find(
      RestaurantSettings,
      {},
      { orderBy: { createdAt: 'asc' }, limit: 1 },
    );
    const data = {
      status: model.status,
      description: model.description,
      availableWeekdays: model.availableWeekdays,
      shifts: model.shifts,
      maxPartySize: model.maxPartySize,
      roomServiceEnabled: model.roomServiceEnabled,
      roomServiceOpensAt: model.roomServiceOpensAt,
      roomServiceClosesAt: model.roomServiceClosesAt,
    };

    if (entity) Object.assign(entity, data);
    else {
      this.em.persist(
        this.em.create(RestaurantSettings, { id: model.id, ...data }),
      );
    }
    await this.em.flush();
  }

  // ───────── Carta ─────────

  async findAllMenuItems(): Promise<MenuItemModel[]> {
    const entities = await this.em.find(
      RestaurantMenuItem,
      {},
      { orderBy: { category: 'asc', name: 'asc' } },
    );
    return entities.map((entity) => this.toMenuItemModel(entity));
  }

  async findActiveMenuItems(): Promise<MenuItemModel[]> {
    const entities = await this.em.find(
      RestaurantMenuItem,
      { status: MenuItemStatus.ACTIVE },
      { orderBy: { category: 'asc', name: 'asc' } },
    );
    return entities.map((entity) => this.toMenuItemModel(entity));
  }

  /** US-24: los platos habilitados que además se pueden pedir a la habitación. */
  async findRoomServiceMenuItems(): Promise<MenuItemModel[]> {
    const entities = await this.em.find(
      RestaurantMenuItem,
      { status: MenuItemStatus.ACTIVE, availableForRoomService: true },
      { orderBy: { category: 'asc', name: 'asc' } },
    );
    return entities.map((entity) => this.toMenuItemModel(entity));
  }

  async findMenuItemById(id: string): Promise<MenuItemModel | null> {
    const entity = await this.em.findOne(RestaurantMenuItem, { id });
    return entity ? this.toMenuItemModel(entity) : null;
  }

  async findMenuItemByName(
    name: string,
    excludeId?: string,
  ): Promise<MenuItemModel | null> {
    const entity = await this.em.findOne(RestaurantMenuItem, {
      name: { $ilike: name },
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    });
    return entity ? this.toMenuItemModel(entity) : null;
  }

  async insertMenuItem(model: MenuItemModel): Promise<void> {
    this.em.persist(this.em.create(RestaurantMenuItem, { ...model }));
    await this.em.flush();
  }

  async updateMenuItem(model: MenuItemModel): Promise<void> {
    const entity = await this.em.findOneOrFail(RestaurantMenuItem, {
      id: model.id,
    });
    // Asignación directa y no em.assign(): Postgres devuelve `decimal` como string y assign()
    // rechazaría el price numérico (mismo caso que los servicios de spa).
    entity.name = model.name;
    entity.description = model.description;
    entity.category = model.category;
    entity.price = model.price;
    entity.status = model.status;
    entity.availableForRoomService = model.availableForRoomService;
    await this.em.flush();
  }

  async deleteMenuItem(id: string): Promise<void> {
    await this.em.nativeDelete(RestaurantMenuItem, { id });
  }

  private toSettingsModel(entity: RestaurantSettings): RestaurantSettingsModel {
    return new RestaurantSettingsModel({
      id: entity.id,
      status: entity.status,
      description: entity.description ?? null,
      availableWeekdays: entity.availableWeekdays,
      shifts: entity.shifts,
      maxPartySize: entity.maxPartySize,
      roomServiceEnabled: entity.roomServiceEnabled,
      roomServiceOpensAt: entity.roomServiceOpensAt,
      roomServiceClosesAt: entity.roomServiceClosesAt,
    });
  }

  private toMenuItemModel(entity: RestaurantMenuItem): MenuItemModel {
    return new MenuItemModel({
      id: entity.id,
      name: entity.name,
      description: entity.description ?? null,
      category: entity.category,
      // decimal llega como string desde pg.
      price: Number(entity.price),
      status: entity.status,
      availableForRoomService: entity.availableForRoomService,
    });
  }
}
