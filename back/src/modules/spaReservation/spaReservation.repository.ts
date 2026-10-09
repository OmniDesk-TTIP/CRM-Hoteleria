import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/core';
import {
  SpaReservation,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import { SpaService } from '../../infrastructure/database/entities/SpaService.entity';
import { SpaReservationModel } from './spaReservation.model';

export interface SpaReservationFilters {
  status?: SpaReservationStatus;
  page: number;
  pageSize: number;
  sortBy: 'createdAt' | 'requestedDate' | 'status';
  sortDir: 'asc' | 'desc';
}

@Injectable()
export class SpaReservationRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<SpaReservationModel | null> {
    const entity = await this.em.findOne(SpaReservation, { id });
    return entity ? this.toModel(entity) : null;
  }

  async findManyPaginated(
    filters: SpaReservationFilters,
  ): Promise<{ items: SpaReservationModel[]; total: number }> {
    const where: FilterQuery<SpaReservation> = {
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [entities, total] = await this.em.findAndCount(
      SpaReservation,
      where,
      {
        orderBy: { [filters.sortBy]: filters.sortDir },
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize,
      },
    );

    return { items: entities.map((entity) => this.toModel(entity)), total };
  }

  async existsPendingSlot(
    telegramUserId: string,
    spaServiceId: string,
    requestedDate: string,
    requestedTime: string,
  ): Promise<boolean> {
    const count = await this.em.count(SpaReservation, {
      telegramUserId,
      spaService: spaServiceId,
      requestedDate,
      requestedTime,
      status: SpaReservationStatus.PENDING,
    });
    return count > 0;
  }

  async insert(model: SpaReservationModel): Promise<void> {
    this.em.persist(
      this.em.create(SpaReservation, {
        id: model.id,
        status: model.status,
        telegramUserId: model.telegramUserId,
        roomReservation: this.em.getReference(
          Reservation,
          model.roomReservationId,
        ),
        spaService: this.em.getReference(SpaService, model.spaServiceId),
        serviceName: model.serviceName,
        guestFullName: model.guestFullName,
        requestedDate: model.requestedDate,
        requestedTime: model.requestedTime,
      }),
    );
    await this.em.flush();
  }

  async updateStatus(model: SpaReservationModel): Promise<void> {
    const entity = await this.em.findOneOrFail(SpaReservation, {
      id: model.id,
    });
    entity.status = model.status;
    await this.em.flush();
  }

  private toModel(entity: SpaReservation): SpaReservationModel {
    return new SpaReservationModel({
      id: entity.id,
      status: entity.status,
      telegramUserId: entity.telegramUserId,
      roomReservationId: entity.roomReservation.id,
      spaServiceId: entity.spaService.id,
      serviceName: entity.serviceName,
      guestFullName: entity.guestFullName,
      requestedDate: entity.requestedDate,
      requestedTime: entity.requestedTime,
      createdAt: entity.createdAt,
    });
  }
}
