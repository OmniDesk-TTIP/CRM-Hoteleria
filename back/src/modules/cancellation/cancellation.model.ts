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

/** Devolución pendiente de un huésped, con la cuenta que ya informó (si la informó). */
export interface PendingRefundPreview {
  reservationId: string;
  checkIn: string;
  checkOut: string;
  amount: number;
  accountAlias: string | null;
  accountHolder: string | null;
}

export interface RefundAccount {
  alias: string;
  holder: string;
}

/** Alias de CBU/CVU: de 6 a 20 caracteres, solo letras, números, puntos y guiones. */
const ALIAS_PATTERN = /^[a-z0-9.-]{6,20}$/;
const HOLDER_MIN_LENGTH = 3;
const HOLDER_MAX_LENGTH = 150;

/** Normaliza y valida lo que dio el huésped. Devuelve la cuenta lista para guardar o el motivo del rechazo. */
export function parseRefundAccount(
  alias: unknown,
  holder: unknown,
): { ok: true; account: RefundAccount } | { ok: false; reason: string } {
  const normalizedAlias =
    typeof alias === 'string' ? alias.trim().toLowerCase() : '';
  const normalizedHolder =
    typeof holder === 'string' ? holder.trim().replace(/\s+/g, ' ') : '';

  if (!normalizedAlias && !normalizedHolder) {
    return {
      ok: false,
      reason:
        'Para hacerte la devolución necesito el alias de tu cuenta bancaria o billetera virtual y el nombre completo del titular.',
    };
  }
  if (!ALIAS_PATTERN.test(normalizedAlias)) {
    return {
      ok: false,
      reason:
        'Ese alias no parece válido: tiene que tener entre 6 y 20 caracteres, solo letras, números, puntos o guiones. ¿Me lo pasás de nuevo?',
    };
  }
  if (
    normalizedHolder.length < HOLDER_MIN_LENGTH ||
    normalizedHolder.length > HOLDER_MAX_LENGTH
  ) {
    return {
      ok: false,
      reason: '¿Me pasás el nombre completo del titular de la cuenta?',
    };
  }
  return {
    ok: true,
    account: { alias: normalizedAlias, holder: normalizedHolder },
  };
}

export function buildRefundAccountBlock(
  refunds: PendingRefundPreview[],
): string | null {
  if (refunds.length === 0) return null;

  const lines = ['DEVOLUCIONES PENDIENTES DEL CLIENTE:'];
  for (const refund of refunds.slice(0, MAX_RESERVATIONS_IN_BLOCK)) {
    const account = refund.accountAlias
      ? `cuenta informada: alias ${refund.accountAlias}, titular ${refund.accountHolder ?? 'sin informar'}`
      : 'FALTA LA CUENTA: pedile el alias y el nombre del titular';
    lines.push(
      `- id=${refund.reservationId} | reserva del ${toChatDate(refund.checkIn)} al ${toChatDate(refund.checkOut)} | a devolver $${refund.amount} | ${account}`,
    );
  }
  return lines.join('\n');
}

export function buildRefundAccountReply(
  account: RefundAccount,
  refund: { amount: number },
): string {
  return [
    `Listo, anoté la cuenta para la devolución de <b>$${refund.amount}</b>:`,
    `• Alias: <b>${escapeHtml(account.alias)}</b>`,
    `• Titular: <b>${escapeHtml(account.holder)}</b>`,
    '',
    'Te escribo por acá cuando hagamos la transferencia. Si algún dato está mal, decime y lo corrijo.',
  ].join('\n');
}

/** Mensaje que recibe el huésped por Telegram cuando recepción marca la devolución como realizada. */
export function buildRefundCompletedMessage(refund: {
  guestFullName: string;
  checkIn: string;
  checkOut: string;
  amount: number;
  accountAlias: string | null;
}): string {
  const [firstName] = refund.guestFullName.trim().split(/\s+/);
  const greeting = firstName ? `¡Hola, ${escapeHtml(firstName)}!` : '¡Hola!';
  const destination = refund.accountAlias
    ? ` a la cuenta con alias <b>${escapeHtml(refund.accountAlias)}</b>`
    : '';
  return [
    `${greeting} Te confirmamos que la cancelación de tu reserva del ${toChatDate(refund.checkIn)} al ${toChatDate(refund.checkOut)} quedó cerrada.`,
    '',
    `Ya te transferimos la devolución de <b>$${refund.amount}</b>${destination}. Revisá tu cuenta y, si no ves el dinero acreditado, escribinos por acá.`,
  ].join('\n');
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
  return [
    `${base} Te corresponde la devolución de <b>$${calculation.refundAmount}</b> (${calculation.refundPercentage}% de la seña) y queda registrada como pendiente.`,
    '',
    'Para hacerte la transferencia, pasame el <b>alias</b> de tu cuenta bancaria o billetera virtual y el <b>nombre completo del titular</b>.',
  ].join('\n');
}
