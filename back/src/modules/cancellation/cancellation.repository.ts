import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { CancellationPolicy } from '../../infrastructure/database/entities/CancellationPolicy.entity';
import {
  RefundStatus,
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import { toCalendarDayString } from '../spa/model/spa.model';
import {
  CancellableReservation,
  CancellationPolicyModel,
  RefundCalculation,
} from './cancellation.model';
import { RefundDto } from './dto/cancellation.dto';

export interface StoredCancellation {
  reservationId: string;
  wasPaid: boolean;
  policyName: string | null;
  refundPercentage: number;
  refundAmount: number;
}

export interface CancellableReservationRecord extends CancellableReservation {
  telegramUserId: string | null;
  refund: StoredCancellation | null;
}

interface RefundFilters {
  status?: RefundStatus;
  page: number;
  pageSize: number;
}

@Injectable()
export class CancellationRepository {
  constructor(private readonly em: EntityManager) {}

  async findAllPolicies(): Promise<CancellationPolicyModel[]> {
    const entities = await this.em.find(
      CancellationPolicy,
      {},
      { orderBy: { active: 'desc', name: 'asc' } },
    );
    return entities.map((entity) => this.toPolicy(entity));
  }

  async findPolicyById(id: string): Promise<CancellationPolicyModel | null> {
    const entity = await this.em.findOne(CancellationPolicy, { id });
    return entity ? this.toPolicy(entity) : null;
  }

  async findPolicyByName(
    name: string,
    excludeId?: string,
  ): Promise<CancellationPolicyModel | null> {
    const entity = await this.em.findOne(CancellationPolicy, {
      name: { $ilike: name },
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    });
    return entity ? this.toPolicy(entity) : null;
  }

  async findActivePolicy(): Promise<CancellationPolicyModel | null> {
    const entity = await this.em.findOne(CancellationPolicy, { active: true });
    return entity ? this.toPolicy(entity) : null;
  }

  async insertPolicy(model: CancellationPolicyModel): Promise<void> {
    this.em.persist(this.em.create(CancellationPolicy, { ...model }));
    await this.em.flush();
  }

  async updatePolicy(model: CancellationPolicyModel): Promise<void> {
    const entity = await this.em.findOneOrFail(CancellationPolicy, {
      id: model.id,
    });
    entity.name = model.name;
    entity.tiers = model.tiers;
    await this.em.flush();
  }

  /** Deja vigente solo esta política. Las dos escrituras van juntas para no quedar con 0 o 2 vigentes. */
  async activatePolicy(id: string): Promise<void> {
    await this.em.transactional(async (tx) => {
      await tx.nativeUpdate(
        CancellationPolicy,
        { id: { $ne: id }, active: true },
        { active: false },
      );
      await tx.nativeUpdate(CancellationPolicy, { id }, { active: true });
    });
  }

  async findReservation(
    id: string,
  ): Promise<CancellableReservationRecord | null> {
    const entity = await this.em.findOne(
      Reservation,
      { id },
      { refresh: true },
    );
    return entity ? this.toRecord(entity) : null;
  }

  async findCancellableByTelegramUserId(telegramUserId: string) {
    const entities = await this.em.find(
      Reservation,
      {
        telegramUserId,
        status: {
          $in: [ReservationStatus.PENDING_PAYMENT, ReservationStatus.CONFIRMED],
        },
      },
      { orderBy: { checkIn: 'asc' }, refresh: true },
    );
    return entities.map((entity) => this.toRecord(entity));
  }

  async applyCancellation(
    id: string,
    calculation: RefundCalculation,
    cancelledAt: Date,
  ): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      Reservation,
      { id, status: { $ne: ReservationStatus.CANCELLED } },
      {
        status: ReservationStatus.CANCELLED,
        cancelledAt,
        ...(calculation.wasPaid
          ? {
              refundPercentage: calculation.refundPercentage,
              refundAmount: calculation.refundAmount,
              ...(calculation.policyName
                ? { cancellationPolicyName: calculation.policyName }
                : {}),
              ...(calculation.refundAmount > 0
                ? { refundStatus: RefundStatus.PENDING }
                : {}),
            }
          : {}),
      },
    );
    return affected === 1;
  }

  async findRefunds(
    filters: RefundFilters,
  ): Promise<{ items: RefundDto[]; total: number }> {
    const [entities, total] = await this.em.findAndCount(
      Reservation,
      { refundStatus: filters.status ?? { $ne: null } },
      {
        populate: ['room'],
        orderBy: { cancelledAt: 'desc', id: 'asc' },
        limit: filters.pageSize,
        offset: (filters.page - 1) * filters.pageSize,
      },
    );
    return { items: entities.map((entity) => this.toRefund(entity)), total };
  }

  async findRefund(reservationId: string): Promise<RefundDto | null> {
    const entity = await this.em.findOne(
      Reservation,
      { id: reservationId, refundStatus: { $ne: null } },
      { populate: ['room'], refresh: true },
    );
    return entity ? this.toRefund(entity) : null;
  }

  async completeRefund(
    reservationId: string,
    refundedAt: Date,
  ): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      Reservation,
      { id: reservationId, refundStatus: RefundStatus.PENDING },
      { refundStatus: RefundStatus.COMPLETED, refundedAt },
    );
    return affected === 1;
  }

  private toPolicy(entity: CancellationPolicy): CancellationPolicyModel {
    return new CancellationPolicyModel({
      id: entity.id,
      name: entity.name,
      tiers: entity.tiers,
      active: entity.active,
    });
  }

  private toRecord(entity: Reservation): CancellableReservationRecord {
    return {
      id: entity.id,
      status: entity.status,
      telegramUserId: entity.telegramUserId ?? null,
      checkIn: toCalendarDayString(entity.checkIn),
      checkOut: toCalendarDayString(entity.checkOut),
      depositAmount: Number(entity.depositAmount),
      refund:
        entity.status === ReservationStatus.CANCELLED
          ? {
              reservationId: entity.id,
              wasPaid:
                entity.refundAmount !== null &&
                entity.refundAmount !== undefined,
              policyName: entity.cancellationPolicyName ?? null,
              refundPercentage: Number(entity.refundPercentage ?? 0),
              refundAmount: Number(entity.refundAmount ?? 0),
            }
          : null,
    };
  }

  private toRefund(entity: Reservation): RefundDto {
    return {
      reservationId: entity.id,
      guestFullName: entity.guestFullName,
      guestDni: entity.guestDni,
      roomNumber: entity.room.roomNumber,
      checkIn: entity.checkIn,
      checkOut: entity.checkOut,
      amount: Number(entity.refundAmount),
      percentage: Number(entity.refundPercentage),
      policyName: entity.cancellationPolicyName ?? null,
      status: entity.refundStatus as RefundStatus,
      cancelledAt: entity.cancelledAt ?? null,
      refundedAt: entity.refundedAt ?? null,
    };
  }
}
