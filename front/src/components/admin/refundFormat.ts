import type { AdminReservation, CancellationPolicy } from '@/config/types';

export const formatMoney = (value: number): string =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(
    Number(value),
  );

export const formatDay = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};

export const formatDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};

export const describeTiers = (policy: Pick<CancellationPolicy, 'tiers'>): string[] => {
  const tiers = [...policy.tiers].sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn);
  const days = (value: number) => (value === 1 ? '1 día' : `${value} días`);
  const percent = (value: number) => (value === 0 ? 'sin devolución' : `devuelve el ${value}% de la seña`);

  const lines = tiers.map((tier, index) => {
    const min = tier.minDaysBeforeCheckIn;
    const previous = tiers[index - 1];
    if (!previous) return `${days(min)} o más antes del check-in: ${percent(tier.refundPercentage)}`;
    const max = previous.minDaysBeforeCheckIn - 1;
    return max === min
      ? `${days(min)} antes del check-in: ${percent(tier.refundPercentage)}`
      : `Entre ${min} y ${days(max)} antes del check-in: ${percent(tier.refundPercentage)}`;
  });

  const lowest = tiers[tiers.length - 1];
  if (lowest && lowest.minDaysBeforeCheckIn > 0) {
    lines.push(`Menos de ${days(lowest.minDaysBeforeCheckIn)} antes del check-in: sin devolución`);
  }
  return lines;
};

export interface RefundEstimate {
  daysInAdvance: number;
  percentage: number;
  amount: number;
}

export const estimateRefund = (
  policy: CancellationPolicy | null,
  reservation: Pick<AdminReservation, 'status' | 'checkIn' | 'depositAmount'>,
): RefundEstimate | null => {
  if (reservation.status !== 'CONFIRMED') return null;

  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [year, month, day] = reservation.checkIn.slice(0, 10).split('-').map(Number);
  const daysInAdvance = Math.round((Date.UTC(year, month - 1, day) - todayUtc) / 86_400_000);

  const tier = policy
    ? [...policy.tiers]
        .sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn)
        .find((candidate) => daysInAdvance >= candidate.minDaysBeforeCheckIn)
    : undefined;
  const percentage = tier?.refundPercentage ?? 0;

  return {
    daysInAdvance,
    percentage,
    amount: Math.round(Number(reservation.depositAmount) * percentage) / 100,
  };
};