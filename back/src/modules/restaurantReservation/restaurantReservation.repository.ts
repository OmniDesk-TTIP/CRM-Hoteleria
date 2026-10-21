import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/core';
import {
  RestaurantReservation,
  RestaurantReservationStatus,
} from '../../infrastructure/database/entities/RestaurantReservation.entity';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import { RestaurantReservationModel } from './restaurantReservation.model';

export interface RestaurantReservationFilters {
  status?: RestaurantReservationStatus;
  page: number;
  pageSize: number;
  sortBy: 'createdAt' | 'requestedDate' | 'status';
  sortDir: 'asc' | 'desc';
}

@Injectable()
export class RestaurantReservationRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<RestaurantReservationModel | null> {
    const entity = await this.em.findOne(RestaurantReservation, { id });
    return entity ? this.toModel(entity) : null;
  }

  async findManyPaginated(
    filters: RestaurantReservationFilters,
  ): Promise<{ items: RestaurantReservationModel[]; total: number }> {
    const where: FilterQuery<RestaurantReservation> = {
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [entities, total] = await this.em.findAndCount(
      RestaurantReservation,
      where,
      {
        orderBy: { [filters.sortBy]: filters.sortDir },
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize,
      },
    );

    return { items: entities.map((entity) => this.toModel(entity)), total };
  }

  /** ¿El huésped ya tiene un pedido pendiente para ese día y hora? Evita duplicados por reintentos. */
  async existsPendingSlot(
    telegramUserId: string,
    requestedDate: string,
    requestedTime: string,
  ): Promise<boolean> {
    const count = await this.em.count(RestaurantReservation, {
      telegramUserId,
      requestedDate,
      requestedTime,
      status: RestaurantReservationStatus.PENDING,
    });
    return count > 0;
  }

  async insert(model: RestaurantReservationModel): Promise<void> {
    this.em.persist(
      this.em.create(RestaurantReservation, {
        id: model.id,
        status: model.status,
        telegramUserId: model.telegramUserId,
        roomReservation: this.em.getReference(
          Reservation,
          model.roomReservationId,
        ),
        guestFullName: model.guestFullName,
        requestedDate: model.requestedDate,
        requestedTime: model.requestedTime,
        partySize: model.partySize,
        notes: model.notes ?? undefined,
      }),
    );
    await this.em.flush();
  }

  async updateStatus(model: RestaurantReservationModel): Promise<void> {
    const entity = await this.em.findOneOrFail(RestaurantReservation, {
      id: model.id,
    });
    entity.status = model.status;
    await this.em.flush();
  }

  private toModel(entity: RestaurantReservation): RestaurantReservationModel {
    return new RestaurantReservationModel({
      id: entity.id,
      status: entity.status,
      telegramUserId: entity.telegramUserId,
      roomReservationId: entity.roomReservation.id,
      guestFullName: entity.guestFullName,
      requestedDate: entity.requestedDate,
      requestedTime: entity.requestedTime,
      partySize: entity.partySize,
      notes: entity.notes ?? null,
      createdAt: entity.createdAt,
    });
  }
}
