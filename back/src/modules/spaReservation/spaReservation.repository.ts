import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery, LockMode } from '@mikro-orm/core';
import {
  SpaReservation,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';
import { Reservation } from '../../infrastructure/database/entities/Reservation.entity';
import { SpaService } from '../../infrastructure/database/entities/SpaService.entity';
import { hasFreeCapacity } from '../spa/model/spa.model';
import {
  OCCUPYING_STATUSES,
  SpaReservationModel,
} from './spaReservation.model';

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

  /** ¿El cliente ya tiene un turno idéntico esperando (confirmación o pago)? Evita duplicados por reintentos. */
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
      status: {
        $in: [
          SpaReservationStatus.PENDING,
          SpaReservationStatus.PENDING_PAYMENT,
        ],
      },
    });
    return count > 0;
  }

  /**
   * Guarda el turno solo si todavía hay lugar. Chequear y guardar tiene que ser una sola
   * operación: sin el lock, dos pedidos simultáneos para el último lugar lo verían libre los dos.
   * Se bloquea la fila del servicio, así los pedidos de un mismo servicio se atienden en fila
   * (los de servicios distintos no se estorban). Devuelve false si no queda capacidad.
   */
  async insertIfCapacity(
    model: SpaReservationModel,
    spa: { capacity: number; durationMinutes: number },
  ): Promise<boolean> {
    return this.em.transactional(async (em) => {
      await em.findOneOrFail(
        SpaService,
        { id: model.spaServiceId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      const booked = await em.find(SpaReservation, {
        spaService: model.spaServiceId,
        requestedDate: model.requestedDate,
        status: { $in: OCCUPYING_STATUSES },
      });

      const hasRoom = hasFreeCapacity(
        booked.map((reservation) => reservation.requestedTime),
        model.requestedTime,
        spa.durationMinutes,
        spa.capacity,
      );
      if (!hasRoom) return false;

      em.persist(
        em.create(SpaReservation, {
          id: model.id,
          status: model.status,
          clientType: model.clientType,
          telegramUserId: model.telegramUserId,
          roomReservation: model.roomReservationId
            ? em.getReference(Reservation, model.roomReservationId)
            : undefined,
          spaService: em.getReference(SpaService, model.spaServiceId),
          serviceName: model.serviceName,
          guestFullName: model.guestFullName,
          guestDni: model.guestDni ?? undefined,
          requestedDate: model.requestedDate,
          requestedTime: model.requestedTime,
          amount: model.amount,
        }),
      );
      return true;
    });
  }

  async updateStatus(model: SpaReservationModel): Promise<void> {
    const entity = await this.em.findOneOrFail(SpaReservation, {
      id: model.id,
    });
    entity.status = model.status;
    await this.em.flush();
  }

  async attachPreference(
    id: string,
    mpPreferenceId: string,
    mpInitPoint: string,
  ): Promise<void> {
    await this.em.nativeUpdate(
      SpaReservation,
      { id },
      { mpPreferenceId, mpInitPoint },
    );
  }

  /**
   * Confirma el turno solo si sigue esperando el pago. El UPDATE condicional es atómico: si el
   * webhook y el redirect de Mercado Pago llegan casi a la vez, uno solo recibe true y el aviso
   * por Telegram se manda una única vez (mismo criterio que las reservas de habitación).
   */
  async confirmIfPendingPayment(
    id: string,
    mpPaymentId: string,
  ): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      SpaReservation,
      { id, status: SpaReservationStatus.PENDING_PAYMENT },
      { status: SpaReservationStatus.CONFIRMED, mpPaymentId },
    );
    return affected === 1;
  }

  /** Cancela los turnos que siguen sin pago desde antes de `cutoff` y devuelve cuántos fueron. */
  async cancelUnpaidBefore(cutoff: Date): Promise<number> {
    return this.em.nativeUpdate(
      SpaReservation,
      {
        status: SpaReservationStatus.PENDING_PAYMENT,
        createdAt: { $lt: cutoff },
      },
      { status: SpaReservationStatus.CANCELLED },
    );
  }

  private toModel(entity: SpaReservation): SpaReservationModel {
    return new SpaReservationModel({
      id: entity.id,
      status: entity.status,
      clientType: entity.clientType,
      telegramUserId: entity.telegramUserId,
      roomReservationId: entity.roomReservation?.id ?? null,
      spaServiceId: entity.spaService.id,
      serviceName: entity.serviceName,
      guestFullName: entity.guestFullName,
      guestDni: entity.guestDni ?? null,
      requestedDate: entity.requestedDate,
      requestedTime: entity.requestedTime,
      // decimal llega como string desde pg.
      amount: Number(entity.amount),
      createdAt: entity.createdAt,
    });
  }
}
