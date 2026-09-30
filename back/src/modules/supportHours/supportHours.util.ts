// Horarios de atención de la recepción.
export interface DaySchedule {
  weekday: number;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
}

export interface ZonedNow {
  weekday: number;
  minutes: number;
}

export interface NextOpening {
  dayOffset: number;
  weekday: number;
  opensAt: string;
}

export const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Traduce un instante a día de la semana y minutos locales de la zona pedida. */
export function zonedNow(date: Date, timeZone: string): ZonedNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';

  return {
    weekday: WEEKDAY_INDEX[read('weekday')] ?? 0,
    minutes: Number(read('hour')) * 60 + Number(read('minute')),
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isOpenAt({ weekday, minutes }: ZonedNow, schedule: DaySchedule[]): boolean {
  const today = schedule.find((day) => day.weekday === weekday);
  if (!today || today.isClosed) return false;

  const opens = toMinutes(today.opensAt);
  const closes = toMinutes(today.closesAt);

  if (opens > closes) return minutes >= opens || minutes < closes;

  return minutes >= opens && minutes < closes;
}

export function findNextOpening({ weekday, minutes }: ZonedNow, schedule: DaySchedule[]): NextOpening | null {
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const targetWeekday = (weekday + dayOffset) % 7;
    const day = schedule.find((entry) => entry.weekday === targetWeekday);
    if (!day || day.isClosed) continue;

    if (dayOffset === 0 && minutes >= toMinutes(day.opensAt)) continue;

    return { dayOffset, weekday: targetWeekday, opensAt: day.opensAt };
  }

  return null;
}

export function describeNextOpening(next: NextOpening | null): string | null {
  if (!next) return null;
  if (next.dayOffset === 0) return `hoy a las ${next.opensAt}`;
  if (next.dayOffset === 1) return `mañana a las ${next.opensAt}`;
  return `el ${WEEKDAY_NAMES[next.weekday]} a las ${next.opensAt}`;
}
