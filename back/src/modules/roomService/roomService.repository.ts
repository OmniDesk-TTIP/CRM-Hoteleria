import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/core';
import {
  RoomServiceOrder,
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import { toCalendarDayString } from '../spa/model/spa.model';
import {
  CurrentStay,
  findCurrentStay,
  OPEN_STATUSES,
  RoomServiceOrderModel,
} from './roomService.model';

export interface RoomServiceOrderFilters {
  status?: RoomServiceOrderStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class RoomServiceRepository {
  constructor(private readonly em: EntityManager) {}

  /** CA1: la reserva confirmada en curso del huésped, con el número de habitación. */
  async findCurrentStay(
    telegramUserId: string,
    today: string,
  ): Promise<CurrentStay | null> {
    const reservations = await this.em.find(
      Reservation,
      { telegramUserId, status: ReservationStatus.CONFIRMED },
      { populate: ['room'] },
    );

    const current = findCurrentStay(
      reservations.map((reservation) => ({
        status: reservation.status,
        checkIn: toCalendarDayString(reservation.checkIn),
        checkOut: toCalendarDayString(reservation.checkOut),
        reservation,
      })),
      today,
    );
    if (!current) return null;

    return {
      reservationId: current.reservation.id,
      guestFullName: current.reservation.guestFullName,
      guestDni: current.reservation.guestDni,
      roomNumber: current.reservation.room.roomNumber,
    };
  }

  // Los cambios de estado van por UPDATE condicional (nativeUpdate), que no toca la identity map:
  // las lecturas refrescan para no devolver una entidad vieja del mismo contexto.
  async findById(id: string): Promise<RoomServiceOrderModel | null> {
    const entity = await this.em.findOne(
      RoomServiceOrder,
      { id },
      { refresh: true },
    );
    return entity ? this.toModel(entity) : null;
  }

  /** El pedido confirmado más reciente que sigue en curso (Recibido o En preparación). */
  async findLatestOpen(
    telegramUserId: string,
  ): Promise<RoomServiceOrderModel | null> {
    const entity = await this.em.findOne(
      RoomServiceOrder,
      { telegramUserId, status: { $in: OPEN_STATUSES } },
      { orderBy: { confirmedAt: 'desc' }, refresh: true },
    );
    return entity ? this.toModel(entity) : null;
  }

  /** CA6: el panel nunca ve los borradores que el huésped no confirmó. */
  async findManyPaginated(
    filters: RoomServiceOrderFilters,
  ): Promise<{ items: RoomServiceOrderModel[]; total: number }> {
    const where: FilterQuery<RoomServiceOrder> = filters.status
      ? { status: filters.status }
      : { status: { $ne: RoomServiceOrderStatus.PENDING_CONFIRMATION } };

    const [entities, total] = await this.em.findAndCount(
      RoomServiceOrder,
      where,
      {
        orderBy: { confirmedAt: 'desc' },
        refresh: true,
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize,
      },
    );
    return { items: entities.map((entity) => this.toModel(entity)), total };
  }

  /** Guarda el borrador nuevo y descarta los anteriores del huésped: hay un solo resumen vigente. */
  async replaceDraft(model: RoomServiceOrderModel): Promise<void> {
    await this.em.transactional(async (em) => {
      await em.nativeDelete(RoomServiceOrder, {
        telegramUserId: model.telegramUserId,
        status: RoomServiceOrderStatus.PENDING_CONFIRMATION,
      });
      em.persist(
        em.create(RoomServiceOrder, {
          id: model.id,
          status: model.status,
          paymentStatus: model.paymentStatus,
          telegramUserId: model.telegramUserId,
          roomReservation: em.getReference(
            Reservation,
            model.roomReservationId,
          ),
          roomNumber: model.roomNumber,
          guestFullName: model.guestFullName,
          items: model.items,
          notes: model.notes,
          total: model.total,
          ...(model.createdAt ? { createdAt: model.createdAt } : {}),
        }),
      );
    });
  }

  async deleteDraft(id: string, telegramUserId: string): Promise<boolean> {
    const deleted = await this.em.nativeDelete(RoomServiceOrder, {
      id,
      telegramUserId,
      status: RoomServiceOrderStatus.PENDING_CONFIRMATION,
    });
    return deleted === 1;
  }

  /**
   * Pasa el borrador a Recibido solo si sigue siendo borrador. El UPDATE condicional es atómico:
   * si el huésped toca "Confirmar pedido" dos veces, uno solo recibe true y se cobra una vez.
   */
  async confirmIfDraft(model: RoomServiceOrderModel): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      RoomServiceOrder,
      { id: model.id, status: RoomServiceOrderStatus.PENDING_CONFIRMATION },
      { status: model.status, confirmedAt: model.confirmedAt },
    );
    return affected === 1;
  }

  /** CA8: cancela solo si sigue Recibido (el panel pudo haberlo pasado a preparación recién). */
  async cancelIfReceived(id: string): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      RoomServiceOrder,
      { id, status: RoomServiceOrderStatus.RECEIVED },
      { status: RoomServiceOrderStatus.CANCELLED },
    );
    return affected === 1;
  }

  async updateStatus(model: RoomServiceOrderModel): Promise<void> {
    await this.em.nativeUpdate(
      RoomServiceOrder,
      { id: model.id },
      { status: model.status },
    );
  }

  async attachPreference(
    id: string,
    mpPreferenceId: string,
    mpInitPoint: string,
  ): Promise<void> {
    await this.em.nativeUpdate(
      RoomServiceOrder,
      { id },
      { mpPreferenceId, mpInitPoint },
    );
  }

  /** Marca el pago una sola vez aunque el webhook y el redirect lleguen juntos. */
  async markPaidIfPending(id: string, mpPaymentId: string): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      RoomServiceOrder,
      { id, paymentStatus: RoomServicePaymentStatus.PENDING },
      { paymentStatus: RoomServicePaymentStatus.PAID, mpPaymentId },
    );
    return affected === 1;
  }

  private toModel(entity: RoomServiceOrder): RoomServiceOrderModel {
    return new RoomServiceOrderModel({
      id: entity.id,
      status: entity.status,
      paymentStatus: entity.paymentStatus,
      telegramUserId: entity.telegramUserId,
      roomReservationId: entity.roomReservation.id,
      roomNumber: entity.roomNumber,
      guestFullName: entity.guestFullName,
      items: entity.items,
      notes: entity.notes ?? null,
      // decimal llega como string desde pg.
      total: Number(entity.total),
      confirmedAt: entity.confirmedAt ?? null,
      mpInitPoint: entity.mpInitPoint ?? null,
      createdAt: entity.createdAt,
    });
  }
}
