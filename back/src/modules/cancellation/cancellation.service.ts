import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import {
  RefundStatus,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import { ChatService } from '../chat/chat.service';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { todayIn } from '../spa/model/spa.model';
import {
  CancellationRepository,
  GuestRefundRecord,
} from './cancellation.repository';
import {
  buildCancellationBlock,
  buildGuestCancellationReply,
  buildPolicySummary,
  buildRefundAccountBlock,
  buildRefundAccountReply,
  buildRefundCompletedMessage,
  calculateRefund,
  CancellationPolicyModel,
  CancellationPreview,
  canCompleteRefund,
  parseRefundAccount,
  RefundCalculation,
} from './cancellation.model';
import {
  CompletedRefundDto,
  CompleteRefundDto,
  CreateCancellationPolicyDto,
  ListRefundsQueryDto,
  PaginatedRefundsDto,
  RefundDto,
  UpdateCancellationPolicyDto,
} from './dto/cancellation.dto';

const EXPIRED_NOT_CANCELLABLE =
  'La reserva ya venció por falta de pago: no se cancela ni genera devolución';

export interface CancellationOutcome extends RefundCalculation {
  reservationId: string;
  alreadyCancelled: boolean;
}

export type GuestCancellationResult =
  { ok: true; reply: string } | { ok: false; reason: string };

export type GuestRefundAccountResult = GuestCancellationResult;

export interface GuestCancellationContext {
  block: string;
  canCancel: boolean;
  /** Tiene devoluciones pendientes: Chamber puede pedirle (o corregirle) la cuenta. */
  canRegisterRefundAccount: boolean;
}

@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private readonly cancellationRepository: CancellationRepository,
    private readonly supportHoursService: SupportHoursService,
    private readonly chatService: ChatService,
    @InjectBot() private readonly bot: Telegraf<Context>,
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
    if (reservation.status === ReservationStatus.EXPIRED) {
      throw new ConflictException(EXPIRED_NOT_CANCELLABLE);
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
      if (current?.status === ReservationStatus.EXPIRED) {
        throw new ConflictException(EXPIRED_NOT_CANCELLABLE);
      }
      return this.alreadyCancelled(id, current?.refund ?? null);
    }

    return { ...calculation, reservationId: id, alreadyCancelled: false };
  }

  async getGuestContextBlock(
    telegramUserId: string,
    now: Date = new Date(),
  ): Promise<GuestCancellationContext> {
    const today = this.today(now);
    const [policy, reservations, pendingRefunds] = await Promise.all([
      this.cancellationRepository.findActivePolicy(),
      this.cancellationRepository.findCancellableByTelegramUserId(
        telegramUserId,
      ),
      this.cancellationRepository.findPendingRefundsByTelegramUserId(
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

    const refundBlock = buildRefundAccountBlock(pendingRefunds);
    return {
      block: [buildCancellationBlock(policy, previews), refundBlock]
        .filter((section): section is string => !!section)
        .join('\n'),
      canCancel: previews.length > 0,
      canRegisterRefundAccount: pendingRefunds.length > 0,
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
      reservation.status === ReservationStatus.EXPIRED ||
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

  async registerRefundAccountForGuest(
    telegramUserId: string,
    reservationId: string,
    alias: unknown,
    holder: unknown,
  ): Promise<GuestRefundAccountResult> {
    const refund =
      await this.cancellationRepository.findGuestRefund(reservationId);
    if (!refund || refund.telegramUserId !== telegramUserId) {
      return {
        ok: false,
        reason:
          'No encontré una devolución a tu nombre para esa reserva. ¿Me confirmás de qué reserva es?',
      };
    }
    if (refund.status !== RefundStatus.PENDING) {
      return {
        ok: false,
        reason:
          'Esa devolución ya figura como realizada, así que no puedo cambiar la cuenta. Si no te llegó, escribinos y lo revisamos.',
      };
    }

    const parsed = parseRefundAccount(alias, holder);
    if (!parsed.ok) return parsed;

    const saved = await this.cancellationRepository.saveRefundAccount(
      reservationId,
      parsed.account,
    );
    if (!saved) {
      return {
        ok: false,
        reason:
          'Esa devolución ya figura como realizada, así que no puedo cambiar la cuenta. Si no te llegó, escribinos y lo revisamos.',
      };
    }
    return {
      ok: true,
      reply: buildRefundAccountReply(parsed.account, refund),
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
  ): Promise<CompletedRefundDto> {
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
    const completedRefund = (await this.cancellationRepository.findRefund(
      reservationId,
    )) as RefundDto;
    const guestRefund =
      await this.cancellationRepository.findGuestRefund(reservationId);
    const guestNotified = guestRefund
      ? await this.notifyRefundCompleted(guestRefund)
      : false;

    return { ...completedRefund, guestNotified };
  }

  /** Avisa al huésped por Telegram. Si falla, la devolución ya quedó registrada igual. */
  private async notifyRefundCompleted(
    refund: GuestRefundRecord,
  ): Promise<boolean> {
    if (!refund.telegramUserId) return false;

    const message = buildRefundCompletedMessage(refund);
    try {
      await this.bot.telegram.sendMessage(refund.telegramUserId, message, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar la devolución de la reserva ${refund.reservationId} a ${refund.telegramUserId}: ${String(error)}`,
      );
      return false;
    }

    try {
      const session = await this.chatService.getOrCreateSession(
        refund.telegramUserId,
      );
      await this.chatService.recordBotMessage(session, message);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar el aviso de devolución en el chat de ${refund.telegramUserId}: ${String(error)}`,
      );
    }
    return true;
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
