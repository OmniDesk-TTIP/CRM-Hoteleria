import { RANGE_OPTIONS } from '@/components/statistics/ranges';
import { formatShortDate } from '@/components/dashboard/format';
import type { StatisticsRange, SurveyPeriod } from '@/config/types';

/** Los mismos atajos que Métricas, más un rango a elección. */
export type ReviewPeriodPreset = StatisticsRange | 'custom';

export const PERIOD_OPTIONS: { value: ReviewPeriodPreset; label: string }[] = [
  ...RANGE_OPTIONS,
  { value: 'custom', label: 'Personalizado' },
];

/** Hoy (YYYY-MM-DD) en la hora del navegador, que en el panel es la del hotel. en-CA ya formatea como ISO. */
export const todayKey = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

const addDays = (key: string, days: number): string => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Días que cubre cada atajo; el día de hoy siempre queda incluido. */
export const presetPeriod = (preset: StatisticsRange, today: string): SurveyPeriod => {
  if (preset === 'all') return {};
  if (preset === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  return { from: addDays(today, -6), to: today };
};

export const describePeriod = ({ from, to }: SurveyPeriod): string => {
  if (from && to) return `Del ${formatShortDate(from)} al ${formatShortDate(to)}`;
  if (from) return `Desde el ${formatShortDate(from)}`;
  if (to) return `Hasta el ${formatShortDate(to)}`;
  return 'Todo el historial';
};
