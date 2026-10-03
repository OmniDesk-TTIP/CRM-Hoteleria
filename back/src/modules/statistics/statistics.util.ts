import { addDays, zonedDateKey } from '../dashboard/dashboard.util';
import { StatisticsRange } from './dto/statistics.dto';

/** Minutos que la zona `timeZone` está por delante de UTC en el instante `date`. */
function offsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );

  return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Instante UTC en que empieza el día `key` (YYYY-MM-DD) en la zona `timeZone`.
 * Las columnas `created_at` están en UTC, así que el límite del período se compara en UTC
 * pero se calcula con el calendario del hotel: "este mes" empieza a las 00:00 de Buenos Aires.
 * Se corrige dos veces por si el offset cambia entre el instante de partida y el resultado.
 */
export function zonedStartOfDay(key: string, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);

  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  const second = guess - offsetMinutes(new Date(first), timeZone) * 60000;

  return new Date(second);
}

/**
 * Primer día del período como fecha de calendario del hotel, o null si no hay límite inferior.
 * - month: día 1 del mes en curso.
 * - 7d: hoy y los 6 días anteriores (7 días de calendario).
 */
export function rangeStartKey(
  range: StatisticsRange,
  now: Date,
  timeZone: string,
): string | null {
  if (range === 'all') return null;

  const today = zonedDateKey(now, timeZone);
  return range === 'month' ? `${today.slice(0, 7)}-01` : addDays(today, -6);
}

/** Porcentaje con un decimal. Con denominador 0 devuelve 0 en vez de NaN. */
export function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
