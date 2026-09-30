const currency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

const compactCurrency = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const formatCurrency = (value: number): string => currency.format(value);


export const formatCompactCurrency = (value: number): string => compactCurrency.format(value);

export const formatPct = (value: number): string =>
  `${value.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;


const keyToDate = (key: string): Date => new Date(`${key.slice(0, 10)}T00:00:00Z`);

export const formatShortDate = (key: string): string =>
  keyToDate(key).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export const formatWeekdayInitial = (key: string): string =>
  keyToDate(key)
    .toLocaleDateString('es-AR', { weekday: 'short', timeZone: 'UTC' })
    .replace('.', '')
    .slice(0, 2);

export const formatDayOfMonth = (key: string): string => String(keyToDate(key).getUTCDate());

export const formatLongDate = (key: string): string =>
  keyToDate(key).toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });


export const formatMonth = (monthKey: string, withYear = false): string =>
  keyToDate(`${monthKey}-01`)
    .toLocaleDateString('es-AR', { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
    .replace('.', '');

export const nightsBetween = (checkIn: string, checkOut: string): number =>
  Math.round((keyToDate(checkOut).getTime() - keyToDate(checkIn).getTime()) / 86_400_000);
