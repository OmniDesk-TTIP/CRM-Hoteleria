import { v4 } from 'uuid';
import { CancellationTier } from '../../infrastructure/database/entities/CancellationPolicy.entity';
import {
  RefundStatus,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import { toDayNumber } from '../reservation/reservation.model';
import { escapeHtml } from '../telegram/telegram.format';

export type { CancellationTier };

export interface CancellationPolicyProps {
  id: string;
  name: string;
  tiers: CancellationTier[];
  active: boolean;
}

export type CancellationPolicyChanges = Partial<
  Pick<CancellationPolicyProps, 'name' | 'tiers'>
>;

export class CancellationPolicyModel {
  readonly id: string;
  name: string;
  tiers: CancellationTier[];
  active: boolean;

  constructor(props: CancellationPolicyProps) {
    this.id = props.id;
    this.name = props.name;
    this.tiers = sortTiers(props.tiers);
    this.active = props.active;
  }

  static create(props: {
    name: string;
    tiers: CancellationTier[];
    active?: boolean;
  }): CancellationPolicyModel {
    return new CancellationPolicyModel({
      id: v4(),
      name: props.name,
      tiers: props.tiers,
      active: props.active ?? false,
    });
  }

  applyChanges(changes: CancellationPolicyChanges): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.tiers !== undefined) this.tiers = sortTiers(changes.tiers);
  }

  getTiersError(): string | null {
    if (this.tiers.length === 0) {
      return 'La política tiene que tener al menos un escalón';
    }

    const days = this.tiers.map((tier) => tier.minDaysBeforeCheckIn);
    if (days.some((value) => !Number.isInteger(value) || value < 0)) {
      return 'Los días de anticipación tienen que ser enteros de 0 o más';
    }
    if (new Set(days).size !== days.length) {
      return 'No puede haber dos escalones con los mismos días de anticipación';
    }
    if (
      this.tiers.some(
        (tier) => tier.refundPercentage < 0 || tier.refundPercentage > 100,
      )
    ) {
      return 'El porcentaje de devolución tiene que estar entre 0 y 100';
    }

    for (let i = 1; i < this.tiers.length; i++) {
      if (this.tiers[i].refundPercentage > this.tiers[i - 1].refundPercentage) {
        return 'Cancelar con más anticipación no puede devolver un porcentaje menor';
      }
    }
    return null;
  }

  refundPercentageFor(daysInAdvance: number): number {
    const tier = this.tiers.find(
      (candidate) => daysInAdvance >= candidate.minDaysBeforeCheckIn,
    );
    return tier?.refundPercentage ?? 0;
  }

  describeTiers(): string[] {
    const lines: string[] = [];
    this.tiers.forEach((tier, index) => {
      const { minDaysBeforeCheckIn: min, refundPercentage: pct } = tier;
      const previous = this.tiers[index - 1];
      lines.push(`${describeRange(min, previous)}: ${describePercentage(pct)}`);
    });

    const lowest = this.tiers[this.tiers.length - 1];
    if (lowest.minDaysBeforeCheckIn > 0) {
      lines.push(
        `Con menos de ${pluralizeDays(lowest.minDaysBeforeCheckIn)} de anticipación: ${describePercentage(0)}`,
      );
    }
    return lines;
  }
}

function sortTiers(tiers: CancellationTier[]): CancellationTier[] {
  return tiers
    .map((tier) => ({ ...tier }))
    .sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn);
}

function pluralizeDays(days: number): string {
  return days === 1 ? '1 día' : `${days} días`;
}

function describeRange(min: number, previous?: CancellationTier): string {
  if (!previous) return `Con ${pluralizeDays(min)} o más de anticipación`;
  const max = previous.minDaysBeforeCheckIn - 1;
  if (max === min) return `Con ${pluralizeDays(min)} de anticipación`;
  return `Con entre ${min} y ${pluralizeDays(max)} de anticipación`;
}

function describePercentage(percentage: number): string {
  return percentage === 0
    ? 'sin devolución de la seña'
    : `devolución del ${percentage}% de la seña`;
}

export interface CancellableReservation {
  id: string;
  status: ReservationStatus;
  checkIn: string;
  checkOut: string;
  depositAmount: number;
}

export interface RefundCalculation {
  daysInAdvance: number;
  wasPaid: boolean;
  policyName: string | null;
  refundPercentage: number;
  refundAmount: number;
}

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export function daysUntilCheckIn(checkIn: string, today: string): number {
  return toDayNumber(checkIn) - toDayNumber(today);
}

export function calculateRefund(
  policy: CancellationPolicyModel | null,
  reservation: CancellableReservation,
  today: string,
): RefundCalculation {
  const daysInAdvance = daysUntilCheckIn(reservation.checkIn, today);
  const wasPaid = reservation.status === ReservationStatus.CONFIRMED;
  const refundPercentage =
    wasPaid && policy ? policy.refundPercentageFor(daysInAdvance) : 0;

  return {
    daysInAdvance,
    wasPaid,
    policyName: policy?.name ?? null,
    refundPercentage,
    refundAmount: wasPaid
      ? round2((reservation.depositAmount * refundPercentage) / 100)
      : 0,
  };
}

export function canCompleteRefund(status: RefundStatus | null): boolean {
  return status === RefundStatus.PENDING;
}

export const MAX_RESERVATIONS_IN_BLOCK = 5;

export interface CancellationPreview {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  depositAmount: number;
  wasPaid: boolean;
  refundPercentage: number;
  refundAmount: number;
}

const toChatDate = (value: string): string =>
  value.split('-').reverse().join('-');

export function buildCancellationBlock(
  policy: CancellationPolicyModel | null,
  previews: CancellationPreview[],
): string {
  const lines = ['[POLÍTICA DE CANCELACIÓN]'];

  if (!policy) {
    lines.push(
      'No hay una política de cancelación cargada: no prometas devoluciones ni montos, ofrecele derivarlo a recepción.',
    );
  } else {
    lines.push(
      `Política vigente (${policy.name}); los porcentajes son sobre la seña abonada:`,
      ...policy.describeTiers().map((line) => `- ${line}`),
    );
  }

  if (previews.length > 0) {
    lines.push('RESERVAS DEL CLIENTE QUE SE PUEDEN CANCELAR:');
    for (const preview of previews.slice(0, MAX_RESERVATIONS_IN_BLOCK)) {
      const outcome = !preview.wasPaid
        ? 'todavía sin pagar: se cancela sin cargo ni devolución'
        : preview.refundAmount > 0
          ? `si cancela hoy se le devuelven $${preview.refundAmount} (${preview.refundPercentage}% de la seña de $${preview.depositAmount})`
          : `si cancela hoy no se le devuelve la seña de $${preview.depositAmount}`;
      lines.push(
        `- id=${preview.reservationId} | del ${toChatDate(preview.checkIn)} al ${toChatDate(preview.checkOut)} | ${outcome}`,
      );
    }
  }

  return lines.join('\n');
}

export function buildPolicySummary(policy: CancellationPolicyModel): string {
  return [
    `<b>Política de cancelación</b> (sobre la seña abonada):`,
    ...policy.describeTiers().map((line) => `• ${escapeHtml(line)}`),
  ].join('\n');
}

export function buildGuestCancellationReply(
  calculation: RefundCalculation,
  stay: { checkIn: string; checkOut: string },
): string {
  const dates = `del ${toChatDate(stay.checkIn)} al ${toChatDate(stay.checkOut)}`;
  const base = `Listo, cancelé tu reserva ${dates}. La habitación quedó liberada.`;

  if (!calculation.wasPaid) {
    return `${base} No habías abonado la seña, así que no hay nada que devolver.`;
  }
  if (calculation.refundAmount <= 0) {
    return `${base} Según la política de cancelación no corresponde devolución de la seña.`;
  }
  return `${base} Te corresponde la devolución de <b>$${calculation.refundAmount}</b> (${calculation.refundPercentage}% de la seña). Queda registrada como pendiente y recepción te va a avisar cuando esté hecha.`;
}
