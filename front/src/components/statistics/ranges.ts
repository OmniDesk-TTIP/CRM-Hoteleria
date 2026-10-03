import type { StatisticsRange } from '@/config/types';

export const RANGE_OPTIONS: { value: StatisticsRange; label: string }[] = [
  { value: 'month', label: 'Este mes' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: 'all', label: 'Histórico' },
];

export const TOTAL_RESERVATIONS_LABEL: Record<StatisticsRange, string> = {
  month: 'Reservas totales del mes',
  '7d': 'Reservas totales de los últimos 7 días',
  all: 'Reservas totales (histórico)',
};
