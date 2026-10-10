import { v4 } from 'uuid';
import { SpaServiceStatus } from '../../../infrastructure/database/entities/SpaService.entity';
import { ReservationStatus } from '../../../infrastructure/database/entities/Reservation.entity';
import { toMinutes, WEEKDAY_NAMES } from '../../supportHours/supportHours.util';

export interface SpaServiceProps {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  /** Turnos que pueden estar en curso a la vez. */
  capacity: number;
  status: SpaServiceStatus;
  availableWeekdays: number[];
  opensAt: string;
  closesAt: string;
}

export type SpaServiceChanges = Partial<Omit<SpaServiceProps, 'id'>>;

/**
 * Regla de negocio del servicio de spa. Es pura (sin DB ni ORM): el repository la convierte
 * desde y hacia la entidad, y el service solo trabaja con esta clase.
 */
export class SpaServiceModel {
  readonly id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
  capacity: number;
  status: SpaServiceStatus;
  availableWeekdays: number[];
  opensAt: string;
  closesAt: string;

  constructor(props: SpaServiceProps) {
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.durationMinutes = props.durationMinutes;
    this.price = props.price;
    this.capacity = props.capacity;
    this.status = props.status;
    this.availableWeekdays = [...props.availableWeekdays];
    this.opensAt = props.opensAt;
    this.closesAt = props.closesAt;
  }

  static create(
    props: Omit<SpaServiceProps, 'id' | 'status' | 'capacity'> &
      Partial<Pick<SpaServiceProps, 'status' | 'capacity'>>,
  ): SpaServiceModel {
    return new SpaServiceModel({
      ...props,
      id: v4(),
      status: props.status ?? SpaServiceStatus.ACTIVE,
      capacity: props.capacity ?? 1,
    });
  }

  isActive(): boolean {
    return this.status === SpaServiceStatus.ACTIVE;
  }

  /** Un servicio inactivo no se ofrece en el bot (CA7). */
  canBeRequested(): boolean {
    return this.isActive();
  }

  /**
   * ¿Se puede tomar este servicio ese día de la semana, empezando a esa hora?
   * El turno tiene que terminar antes (o justo al) cierre de la franja.
   */
  isAvailableAt(weekday: number, startTime: string): boolean {
    if (!this.canBeRequested()) return false;
    if (!this.availableWeekdays.includes(weekday)) return false;

    const start = toMinutes(startTime);
    return (
      start >= toMinutes(this.opensAt) &&
      start + this.durationMinutes <= toMinutes(this.closesAt)
    );
  }

  /** Aplica cambios parciales. No valida: llamar a `getScheduleError()` después. */
  applyChanges(changes: SpaServiceChanges): void {
    if (changes.name !== undefined) this.name = changes.name;
    if (changes.description !== undefined)
      this.description = changes.description;
    if (changes.durationMinutes !== undefined)
      this.durationMinutes = changes.durationMinutes;
    if (changes.price !== undefined) this.price = changes.price;
    if (changes.capacity !== undefined) this.capacity = changes.capacity;
    if (changes.status !== undefined) this.status = changes.status;
    if (changes.availableWeekdays !== undefined)
      this.availableWeekdays = [...changes.availableWeekdays];
    if (changes.opensAt !== undefined) this.opensAt = changes.opensAt;
    if (changes.closesAt !== undefined) this.closesAt = changes.closesAt;
  }

  deactivate(): void {
    this.status = SpaServiceStatus.INACTIVE;
  }

  /** Devuelve el motivo si la configuración horaria es inconsistente, o null si está bien. */
  getScheduleError(): string | null {
    if (this.capacity < 1) {
      return 'La capacidad tiene que ser de al menos 1 turno simultáneo';
    }

    const weekdays = this.availableWeekdays;
    if (weekdays.length === 0) {
      return 'El servicio tiene que estar disponible al menos un día de la semana';
    }
    if (new Set(weekdays).size !== weekdays.length) {
      return 'Los días de la semana no pueden repetirse';
    }

    const opens = toMinutes(this.opensAt);
    const closes = toMinutes(this.closesAt);
    if (opens >= closes) {
      return 'La hora de cierre tiene que ser posterior a la de apertura';
    }
    if (this.durationMinutes > closes - opens) {
      return 'La duración del servicio no entra en la franja horaria indicada';
    }
    return null;
  }
}

// ───────── Capacidad ─────────

/**
 * ¿Entra un turno nuevo sin pasarse de la capacidad del servicio?
 *
 * `bookedStarts` son las horas de inicio (HH:mm) de los turnos que ya ocupan lugar ese día. Todos
 * son del mismo servicio, así que duran lo mismo. La ocupación más alta dentro del turno nuevo
 * se da al empezar él o al empezar otro que caiga adentro, así que alcanza con mirar esos puntos:
 * dos turnos que se tocan sin superponerse (15:00-16:00 y 16:00-17:00) no cuentan como simultáneos.
 */
export function hasFreeCapacity(
  bookedStarts: string[],
  startTime: string,
  durationMinutes: number,
  capacity: number,
): boolean {
  const start = toMinutes(startTime);
  const end = start + durationMinutes;
  const booked = bookedStarts.map(toMinutes);

  const checkpoints = [start, ...booked.filter((b) => b > start && b < end)];
  return checkpoints.every(
    (point) =>
      booked.filter((b) => b <= point && point < b + durationMinutes).length <
      capacity,
  );
}

// ───────── Fechas (YYYY-MM-DD) ─────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Normaliza el valor de una columna `date` a YYYY-MM-DD. Según el driver llega como string o como
 * Date; en el segundo caso se mira el mediodía para no correr de día por la zona horaria
 * (misma técnica que `toCalendarDay` en reservation.service).
 */
export function toCalendarDayString(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);

  const midday = new Date(value.getTime() + MS_PER_DAY / 2);
  const year = midday.getFullYear();
  const month = String(midday.getMonth() + 1).padStart(2, '0');
  const day = String(midday.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Día de hoy (YYYY-MM-DD) en la zona horaria indicada: la base corre en UTC, el hotel no. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

// ───────── Elegibilidad del huésped (CA2) ─────────

/** Lo mínimo de una reserva que hace falta para decidir si el huésped puede pedir servicios. */
export interface EligibilityReservation {
  status: ReservationStatus;
  /** Día de entrada en formato YYYY-MM-DD. */
  checkIn: string;
  /** Día de salida en formato YYYY-MM-DD. */
  checkOut: string;
}

export interface StayWindow {
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD */
  checkOut: string;
}

/** La estadia que habilita al huesped a pedir servicios, y el "hoy" con el que se evaluo. */
export interface EligibleStay {
  reservationId: string;
  guestFullName: string;
  stay: StayWindow;
  /** YYYY-MM-DD en la zona horaria del hotel. */
  today: string;
}

/**
 * CA2: los servicios internos (spa, restaurante) son para huéspedes con reserva confirmada o
 * actualmente alojados. No existe un check-in efectivo, así que "alojado" se deriva de la reserva:
 * una reserva CONFIRMED cuyo día de salida todavía no pasó cubre las dos cosas (la futura
 * confirmada y la que está en curso, incluido el propio día de salida).
 *
 * `today` va en YYYY-MM-DD, calculado en la zona horaria del hotel; con ese formato la
 * comparación de strings equivale a comparar fechas.
 *
 * Si hay más de una, devuelve la que termina primero (la estadía en curso o la más próxima).
 */
export function findEligibleReservation<T extends EligibilityReservation>(
  reservations: T[],
  today: string,
): T | null {
  const eligible = reservations
    .filter(
      (reservation) =>
        reservation.status === ReservationStatus.CONFIRMED &&
        reservation.checkOut >= today,
    )
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut));

  return eligible[0] ?? null;
}

// ───────── Bloque de servicios para Chamber (CA3/CA7) ─────────

/** Tope de servicios y de largo de descripción para no inflar el prompt de cada mensaje. */
export const MAX_SPA_SERVICES_IN_BLOCK = 20;
export const MAX_DESCRIPTION_LENGTH = 300;

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function describeWeekdays(weekdays: number[]): string {
  if (weekdays.length === 7) return 'todos los días';
  return WEEK_ORDER.filter((day) => weekdays.includes(day))
    .map((day) => WEEKDAY_NAMES[day])
    .join(', ');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Sección `[SERVICIOS DEL HOTEL]` que se agrega al contexto de Chamber. Se arma en cada mensaje
 * desde la DB (no desde el RAG), así un servicio deshabilitado deja de ofrecerse en la próxima
 * consulta (CA7). Recibe solo servicios activos.
 *
 * Los huéspedes no pagan el spa; los clientes externos sí, y el bloque lo dice para que el bot
 * informe el precio correcto y pida los datos del pago antes de reservar.
 */
export function buildSpaServicesBlock(
  spaServices: SpaServiceModel[],
  isGuest: boolean,
): string {
  const lines = [
    '[SERVICIOS DEL HOTEL]',
    isGuest
      ? 'CLIENTE: HUÉSPED del hotel. Los servicios del spa son SIN CARGO para él.'
      : 'CLIENTE: EXTERNO (no se hospeda en el hotel). Los servicios del spa se pagan: el turno queda confirmado cuando paga el link de pago que se le envía.',
    'SPA:',
  ];

  if (spaServices.length === 0) {
    lines.push('- No hay servicios de spa disponibles por el momento.');
  }

  for (const service of spaServices.slice(0, MAX_SPA_SERVICES_IN_BLOCK)) {
    const price = isGuest ? 'SIN CARGO' : `$${service.price}`;
    lines.push(
      `- id=${service.id} | ${service.name} | ${service.durationMinutes} min | ${price} | ${describeWeekdays(service.availableWeekdays)} de ${service.opensAt} a ${service.closesAt}`,
      `  ${truncate(service.description, MAX_DESCRIPTION_LENGTH)}`,
    );
  }

  return lines.join('\n');
}
