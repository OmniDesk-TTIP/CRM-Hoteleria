import { v4 } from 'uuid';
import { StayWindow } from '../spa/model/spa.model';
import { toMinutes } from '../supportHours/supportHours.util';
import {
  SpaReservationClientType,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';

/** Con cuántos días de anticipación puede reservar un cliente externo (no tiene estadía que lo acote). */
export const EXTERNAL_BOOKING_HORIZON_DAYS = 60;

export interface SpaReservationProps {
  id: string;
  status: SpaReservationStatus;
  clientType: SpaReservationClientType;
  telegramUserId: string;
  /** La reserva de habitación del huésped; null para clientes externos. */
  roomReservationId: string | null;
  spaServiceId: string;
  serviceName: string;
  guestFullName: string;
  /** Solo clientes externos. */
  guestDni: string | null;
  /** YYYY-MM-DD */
  requestedDate: string;
  /** HH:mm */
  requestedTime: string;
  /** 0 para huéspedes, el precio del servicio para externos. */
  amount: number;
  createdAt?: Date;
}

export type NewSpaReservationProps = Omit<
  SpaReservationProps,
  'id' | 'status' | 'createdAt'
>;

/**
 * Transiciones válidas. El huésped espera a recepción (PENDING); el cliente externo espera el
 * pago (PENDING_PAYMENT) y no pasa por recepción: se confirma al acreditarse o se cancela si vence.
 */
const ALLOWED_TRANSITIONS: Record<
  SpaReservationStatus,
  SpaReservationStatus[]
> = {
  [SpaReservationStatus.PENDING]: [
    SpaReservationStatus.CONFIRMED,
    SpaReservationStatus.REJECTED,
  ],
  [SpaReservationStatus.PENDING_PAYMENT]: [
    SpaReservationStatus.CONFIRMED,
    SpaReservationStatus.CANCELLED,
  ],
  [SpaReservationStatus.CONFIRMED]: [],
  [SpaReservationStatus.REJECTED]: [],
  [SpaReservationStatus.CANCELLED]: [],
};

/** Estados en los que el turno ocupa un lugar de la capacidad del servicio. */
export const OCCUPYING_STATUSES = [
  SpaReservationStatus.PENDING,
  SpaReservationStatus.PENDING_PAYMENT,
  SpaReservationStatus.CONFIRMED,
];

/** YYYY-MM-DD más `days` días, sin pasar por la zona horaria del servidor. */
function addDays(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/**
 * Regla de negocio de un turno de spa. Pura: sin DB ni ORM.
 * El repository la convierte desde y hacia la entidad.
 */
export class SpaReservationModel {
  readonly id: string;
  status: SpaReservationStatus;
  readonly clientType: SpaReservationClientType;
  readonly telegramUserId: string;
  readonly roomReservationId: string | null;
  readonly spaServiceId: string;
  readonly serviceName: string;
  readonly guestFullName: string;
  readonly guestDni: string | null;
  readonly requestedDate: string;
  readonly requestedTime: string;
  readonly amount: number;
  readonly createdAt?: Date;

  constructor(props: SpaReservationProps) {
    this.id = props.id;
    this.status = props.status;
    this.clientType = props.clientType;
    this.telegramUserId = props.telegramUserId;
    this.roomReservationId = props.roomReservationId;
    this.spaServiceId = props.spaServiceId;
    this.serviceName = props.serviceName;
    this.guestFullName = props.guestFullName;
    this.guestDni = props.guestDni;
    this.requestedDate = props.requestedDate;
    this.requestedTime = props.requestedTime;
    this.amount = props.amount;
    this.createdAt = props.createdAt;
  }

  /**
   * El huésped arranca PENDING (lo confirma recepción); el externo, PENDING_PAYMENT (se confirma
   * solo al pagar). Nada queda confirmado antes de tiempo.
   */
  static create(props: NewSpaReservationProps): SpaReservationModel {
    return new SpaReservationModel({
      ...props,
      id: v4(),
      status:
        props.clientType === SpaReservationClientType.EXTERNAL
          ? SpaReservationStatus.PENDING_PAYMENT
          : SpaReservationStatus.PENDING,
    });
  }

  /**
   * ¿La fecha y la hora pedidas son válidas? Devuelve el motivo (apto para mostrarle al cliente)
   * o null si está bien. Las fechas van en YYYY-MM-DD, así que comparar strings equivale a
   * comparar días. `today` y `nowMinutes` son de la zona horaria del hotel.
   *
   * El huésped solo puede pedir dentro de su estadía (`stay`); el externo no tiene estadía y
   * queda acotado por el horizonte de reserva.
   */
  static getDateError(input: {
    requestedDate: string;
    requestedTime: string;
    today: string;
    nowMinutes: number;
    stay: StayWindow | null;
  }): string | null {
    const { requestedDate, requestedTime, today, nowMinutes, stay } = input;

    if (requestedDate < today) return 'Esa fecha ya pasó.';
    if (requestedDate === today && toMinutes(requestedTime) <= nowMinutes) {
      return 'Ese horario ya pasó.';
    }

    if (stay) {
      if (requestedDate < stay.checkIn || requestedDate > stay.checkOut) {
        return 'Solo puedo tomar turnos durante tu estadía.';
      }
    } else if (requestedDate > addDays(today, EXTERNAL_BOOKING_HORIZON_DAYS)) {
      return `Solo tomo turnos con hasta ${EXTERNAL_BOOKING_HORIZON_DAYS} días de anticipación.`;
    }
    return null;
  }

  canTransitionTo(next: SpaReservationStatus): boolean {
    return ALLOWED_TRANSITIONS[this.status].includes(next);
  }

  /**
   * Resolución desde el panel: recepción confirma o rechaza un turno de huésped. Un turno que
   * espera el pago no se resuelve a mano. Devuelve el motivo si no se pudo, o null si se aplicó.
   */
  changeStatus(next: SpaReservationStatus): string | null {
    if (this.status === SpaReservationStatus.PENDING_PAYMENT) {
      return 'El turno está esperando el pago del cliente';
    }
    return this.transitionTo(next);
  }

  /** Se acreditó el pago: el turno del cliente externo queda confirmado. */
  confirmPayment(): string | null {
    if (this.status !== SpaReservationStatus.PENDING_PAYMENT) {
      return `El turno no está esperando un pago (${this.status})`;
    }
    return this.transitionTo(SpaReservationStatus.CONFIRMED);
  }

  /** El pago no llegó a tiempo: el turno se cancela y el lugar se libera. */
  expirePayment(): string | null {
    if (this.status !== SpaReservationStatus.PENDING_PAYMENT) {
      return `El turno no está esperando un pago (${this.status})`;
    }
    return this.transitionTo(SpaReservationStatus.CANCELLED);
  }

  private transitionTo(next: SpaReservationStatus): string | null {
    if (!this.canTransitionTo(next)) {
      return `No se puede pasar una solicitud de ${this.status} a ${next}`;
    }
    this.status = next;
    return null;
  }

  /** Aviso para el cliente cuando su turno queda resuelto; null en los demás estados. */
  getStatusNotice(): string | null {
    const [year, month, day] = this.requestedDate.split('-');
    const slot = `del ${day}/${month}/${year} a las ${this.requestedTime}`;

    if (this.status === SpaReservationStatus.CONFIRMED) {
      const paid =
        this.clientType === SpaReservationClientType.EXTERNAL
          ? '¡Recibimos tu pago! '
          : '';
      return `✅ ${paid}Tu turno de ${this.serviceName} ${slot} quedó confirmado. ¡Te esperamos!`;
    }
    if (this.status === SpaReservationStatus.REJECTED) {
      return `No pudimos confirmar tu turno de ${this.serviceName} ${slot}. Si querés, elegimos otro horario.`;
    }
    return null;
  }
}
