import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { todayIn } from '../spa/model/spa.model';
import { CancellationRepository } from './cancellation.repository';
import {
  buildCancellationBlock,
  buildGuestCancellationReply,
  buildPolicySummary,
  calculateRefund,
  CancellationPolicyModel,
  CancellationPreview,
  canCompleteRefund,
  RefundCalculation,
} from './cancellation.model';
import {
  CompleteRefundDto,
  CreateCancellationPolicyDto,
  ListRefundsQueryDto,
  PaginatedRefundsDto,
  RefundDto,
  UpdateCancellationPolicyDto,
} from './dto/cancellation.dto';

export interface CancellationOutcome extends RefundCalculation {
  reservationId: string;
  alreadyCancelled: boolean;
}

export type GuestCancellationResult =
  | { ok: true; reply: string }
  | { ok: false; reason: string };

@Injectable()
export class CancellationService {
  constructor(
    private readonly cancellationRepository: CancellationRepository,
    private readonly supportHoursService: SupportHoursService,
  ) {}

  listPolicies(): Promise<CancellationPolicyModel[]> {
    return this.cancellationRepository.findAllPolicies();
  }

  async createPolicy(
    payload: CreateCancellationPolicyDto,
  ): Promise<CancellationPolicyModel> {
    await this.assertNameIsFree(payload.name);

    const policy = CancellationPolicyModel.create({
      name: payload.name,
      tiers: payload.tiers,
    });
    this.assertValid(policy);

    const hasActive = await this.cancellationRepository.findActivePolicy();
    await this.cancellationRepository.insertPolicy(policy);
    if (!hasActive) {
      await this.cancellationRepository.activatePolicy(policy.id);
      policy.active = true;
    }
    return policy;
  }

  async updatePolicy(
    id: string,
    payload: UpdateCancellationPolicyDto,
  ): Promise<CancellationPolicyModel> {
    const policy = await this.getPolicyOrFail(id);

    if (payload.name !== undefined) {
      await this.assertNameIsFree(payload.name, id);
    }
    policy.applyChanges(payload);
    this.assertValid(policy);

    await this.cancellationRepository.updatePolicy(policy);
    return policy;
  }

  async activatePolicy(id: string): Promise<CancellationPolicyModel> {
    const policy = await this.getPolicyOrFail(id);
    await this.cancellationRepository.activatePolicy(id);
    policy.active = true;
    return policy;
  }

  async cancelReservation(
    id: string,
    now: Date = new Date(),
  ): Promise<CancellationOutcome> {
    const reservation = await this.cancellationRepository.findReservation(id);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    if (reservation.status === ReservationStatus.CANCELLED) {
      return this.alreadyCancelled(reservation.id, reservation.refund);
    }

    const policy = await this.cancellationRepository.findActivePolicy();
    const calculation = calculateRefund(policy, reservation, this.today(now));

    const applied = await this.cancellationRepository.applyCancellation(
      id,
      calculation,
      now,
    );
    if (!applied) {
      const current = await this.cancellationRepository.findReservation(id);
      return this.alreadyCancelled(id, current?.refund ?? null);
    }

    return { ...calculation, reservationId: id, alreadyCancelled: false };
  }


  async getGuestContextBlock(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<{ block: string; canCancel: boolean }> {
    const today = this.today(now);
    const [policy, reservations] = await Promise.all([
      this.cancellationRepository.findActivePolicy(),
      this.cancellationRepository.findCancellableByTelegramUserId(
        telegramUserId,
      ),
    ]);

    const previews: CancellationPreview[] = reservations
      .filter((reservation) => reservation.checkOut >= today)
      .map((reservation) => {
        const calculation = calculateRefund(policy, reservation, today);
        return {
          reservationId: reservation.id,
          checkIn: reservation.checkIn,
          checkOut: reservation.checkOut,
          depositAmount: reservation.depositAmount,
          wasPaid: calculation.wasPaid,
          refundPercentage: calculation.refundPercentage,
          refundAmount: calculation.refundAmount,
        };
      });

    return {
      block: buildCancellationBlock(policy, previews),
      canCancel: previews.length > 0,
    };
  }

  async getPolicySummary(): Promise<string | null> {
    const policy = await this.cancellationRepository.findActivePolicy();
    return policy ? buildPolicySummary(policy) : null;
  }

  async cancelForGuest(
    telegramUserId: string,
    reservationId: string,
    now: Date = new Date(),
  ): Promise<GuestCancellationResult> {
    const reservation =
      await this.cancellationRepository.findReservation(reservationId);
    if (!reservation || reservation.telegramUserId !== telegramUserId) {
      return {
        ok: false,
        reason:
          'No encontré esa reserva a tu nombre. ¿Me confirmás las fechas de la que querés cancelar?',
      };
    }
    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.checkOut < this.today(now)
    ) {
      return {
        ok: false,
        reason: 'Esa reserva ya no se puede cancelar.',
      };
    }

    const outcome = await this.cancelReservation(reservationId, now);
    return {
      ok: true,
      reply: buildGuestCancellationReply(outcome, reservation),
    };
  }

  async listRefunds(query: ListRefundsQueryDto): Promise<PaginatedRefundsDto> {
    const { items, total } = await this.cancellationRepository.findRefunds({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { data: items, total, page: query.page, pageSize: query.pageSize };
  }

  async completeRefund(
    reservationId: string,
    payload: CompleteRefundDto,
    now: Date = new Date(),
  ): Promise<RefundDto> {
    const refund = await this.cancellationRepository.findRefund(reservationId);
    if (!refund) throw new NotFoundException('Devolución no encontrada');
    if (!canCompleteRefund(refund.status)) {
      throw new ConflictException(
        'La devolución ya estaba marcada como realizada',
      );
    }

    const refundedAt = payload.refundedAt ? new Date(payload.refundedAt) : now;
    if (refundedAt.getTime() > now.getTime()) {
      throw new BadRequestException(
        'La fecha de la devolución no puede ser futura',
      );
    }

    const completed = await this.cancellationRepository.completeRefund(
      reservationId,
      refundedAt,
    );
    if (!completed) {
      throw new ConflictException(
        'La devolución ya estaba marcada como realizada',
      );
    }
    return (await this.cancellationRepository.findRefund(
      reservationId,
    )) as RefundDto;
  }

  private today(now: Date): string {
    return todayIn(this.supportHoursService.getTimeZone(), now);
  }

  private alreadyCancelled(
    reservationId: string,
    stored: {
      wasPaid: boolean;
      policyName: string | null;
      refundPercentage: number;
      refundAmount: number;
    } | null,
  ): CancellationOutcome {
    return {
      reservationId,
      alreadyCancelled: true,
      daysInAdvance: 0,
      wasPaid: stored?.wasPaid ?? false,
      policyName: stored?.policyName ?? null,
      refundPercentage: stored?.refundPercentage ?? 0,
      refundAmount: stored?.refundAmount ?? 0,
    };
  }

  private async getPolicyOrFail(id: string): Promise<CancellationPolicyModel> {
    const policy = await this.cancellationRepository.findPolicyById(id);
    if (!policy) throw new NotFoundException('Política no encontrada');
    return policy;
  }

  private assertValid(policy: CancellationPolicyModel): void {
    const error = policy.getTiersError();
    if (error) throw new BadRequestException(error);
  }

  private async assertNameIsFree(
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.cancellationRepository.findPolicyByName(
      name,
      excludeId,
    );
    if (existing) {
      throw new ConflictException('Ya existe una política con ese nombre');
    }
  }
}