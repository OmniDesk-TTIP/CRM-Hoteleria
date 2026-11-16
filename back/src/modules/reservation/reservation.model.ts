const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

export const PAYMENT_REMINDER_MINUTES_BEFORE = 10;

export const EXPIRED_REASON = 'Vencida por falta de pago';

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MS_PER_MINUTE);
}

export function minutesUntil(deadline: Date, now: Date): number {
  return Math.max(
    1,
    Math.ceil((deadline.getTime() - now.getTime()) / MS_PER_MINUTE),
  );
}

export function describeMinutes(minutes: number): string {
  return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

export interface DayRange {
  checkIn: number;
  checkOut: number;
}

export type StayVariantKind =
  'SHIFT_LATER' | 'SHIFT_EARLIER' | 'EXTEND_AFTER' | 'EXTEND_BEFORE';

export interface StayVariant {
  kind: StayVariantKind;
  stay: DayRange;
  roomId: string;
}

export function toDayNumber(value: Date | string): number {
  if (typeof value === 'string') {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
  }

  const midday = new Date(value.getTime() + MS_PER_DAY / 2);
  return Math.round(
    Date.UTC(midday.getFullYear(), midday.getMonth(), midday.getDate()) /
      MS_PER_DAY,
  );
}

export function fromDayNumber(day: number): Date {
  const utc = new Date(day * MS_PER_DAY);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

export class RoomSchedule {
  private readonly bookings: readonly DayRange[];

  constructor(
    readonly roomId: string,
    bookings: DayRange[],
  ) {
    this.bookings = [...bookings];
  }

  isNightOccupied(night: number): boolean {
    return this.bookings.some(
      (booking) => booking.checkIn <= night && night < booking.checkOut,
    );
  }

  isFree(stay: DayRange): boolean {
    return !this.bookings.some(
      (booking) =>
        booking.checkIn < stay.checkOut && booking.checkOut > stay.checkIn,
    );
  }

  leavesSingleNightGap(stay: DayRange): boolean {
    return (
      this.freeNightsBefore(stay) === 1 || this.freeNightsAfter(stay) === 1
    );
  }

  touchesBooking(stay: DayRange): boolean {
    return (
      this.freeNightsBefore(stay) === 0 || this.freeNightsAfter(stay) === 0
    );
  }

  private freeNightsBefore(stay: DayRange): 0 | 1 | 2 {
    if (this.isNightOccupied(stay.checkIn - 1)) return 0;
    return this.isNightOccupied(stay.checkIn - 2) ? 1 : 2;
  }

  private freeNightsAfter(stay: DayRange): 0 | 1 | 2 {
    if (this.isNightOccupied(stay.checkOut)) return 0;
    return this.isNightOccupied(stay.checkOut + 1) ? 1 : 2;
  }
}

export function pickRoomAvoidingGap(
  schedules: RoomSchedule[],
  stay: DayRange,
): { schedule: RoomSchedule; leavesGap: boolean } | null {
  const free = schedules.filter((schedule) => schedule.isFree(stay));
  if (free.length === 0) return null;

  const clean = free.find((schedule) => !schedule.leavesSingleNightGap(stay));
  return clean
    ? { schedule: clean, leavesGap: false }
    : { schedule: free[0], leavesGap: true };
}

export function findGapFreeVariants(
  requested: DayRange,
  schedules: RoomSchedule[],
  earliestDay: number,
  limit: number,
): StayVariant[] {
  const { checkIn, checkOut } = requested;
  const candidates: [StayVariantKind, DayRange][] = [
    ['SHIFT_LATER', { checkIn: checkIn + 1, checkOut: checkOut + 1 }],
    ['SHIFT_EARLIER', { checkIn: checkIn - 1, checkOut: checkOut - 1 }],
    ['EXTEND_AFTER', { checkIn, checkOut: checkOut + 1 }],
    ['EXTEND_BEFORE', { checkIn: checkIn - 1, checkOut }],
  ];

  const variants: StayVariant[] = [];
  for (const [kind, stay] of candidates) {
    if (stay.checkIn < earliestDay) continue;

    const schedule = schedules.find(
      (s) =>
        s.isFree(stay) &&
        !s.leavesSingleNightGap(stay) &&
        s.touchesBooking(stay),
    );
    if (!schedule) continue;

    variants.push({ kind, stay, roomId: schedule.roomId });
    if (variants.length === limit) break;
  }
  return variants;
}
