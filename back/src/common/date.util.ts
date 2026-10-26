// Aritmética de fechas "de calendario" (YYYY-MM-DD). Se trabaja con strings y
// Date.UTC para que el huso horario del servidor no corra ningún día.

/** Fecha local (YYYY-MM-DD) de un instante en la zona pedida. en-CA ya formatea como ISO. */
export function zonedDateKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function addDays(key: string, days: number): string {
  const date = keyToUtc(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(monthKey: string, months: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return date.toISOString().slice(0, 7);
}

export function daysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function keyToUtc(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Las columnas `date` llegan como string desde MikroORM, pero el tipo de la entidad dice Date. */
export function toDateKey(value: Date | string): string {
  return typeof value === 'string'
    ? value.slice(0, 10)
    : value.toISOString().slice(0, 10);
}

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

export function zonedStartOfDay(key: string, timeZone: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);

  const first = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  const second = guess - offsetMinutes(new Date(first), timeZone) * 60000;

  return new Date(second);
}
