import { v4 } from 'uuid';
import { StayWindow } from '../spa/model/spa.model';
import { toMinutes } from '../supportHours/supportHours.util';
import { RestaurantReservationStatus } from '../../infrastructure/database/entities/RestaurantReservation.entity';

export interface RestaurantReservationProps {
  id: string;
  status: RestaurantReservationStatus;
  telegramUserId: string;
  roomReservationId: string;
  guestFullName: string;
  requestedDate: string;
  requestedTime: string;
  partySize: number;
  notes: string | null;
  createdAt?: Date;
}

export type NewRestaurantReservationProps = Omit<
  RestaurantReservationProps,
  'id' | 'status' | 'createdAt'
>;

/** US-27: datos opcionales del ticket del restó que se carga a la cuenta. */
export const MAX_TICKET_NUMBER_LENGTH = 30;
export const MAX_TICKET_DETAIL_LENGTH = 150;

/**
 * Cómo queda el ticket en la cuenta: "Restó: ticket N° 1234 · Cena para 2". Con los topes de
 * arriba entra en los 200 caracteres de la descripción de un movimiento.
 */
export function ticketDescription(
  ticketNumber?: string | null,
  detail?: string | null,
): string {
  const parts = [
    ticketNumber?.trim() ? `ticket N° ${ticketNumber.trim()}` : null,
    detail?.trim() || null,
  ].filter((part): part is string => part !== null);
  return `Restó: ${parts.length ? parts.join(' · ') : 'consumo'}`;
}

const ALLOWED_TRANSITIONS: Record<
  RestaurantReservationStatus,
  RestaurantReservationStatus[]
> = {
  [RestaurantReservationStatus.PENDING]: [
    RestaurantReservationStatus.CONFIRMED,
    RestaurantReservationStatus.REJECTED,
  ],
  [RestaurantReservationStatus.CONFIRMED]: [],
  [RestaurantReservationStatus.REJECTED]: [],
};

export class RestaurantReservationModel {
  readonly id: string;
  status: RestaurantReservationStatus;
  readonly telegramUserId: string;
  readonly roomReservationId: string;
  readonly guestFullName: string;
  readonly requestedDate: string;
  readonly requestedTime: string;
  readonly partySize: number;
  readonly notes: string | null;
  readonly createdAt?: Date;

  constructor(props: RestaurantReservationProps) {
    this.id = props.id;
    this.status = props.status;
    this.telegramUserId = props.telegramUserId;
    this.roomReservationId = props.roomReservationId;
    this.guestFullName = props.guestFullName;
    this.requestedDate = props.requestedDate;
    this.requestedTime = props.requestedTime;
    this.partySize = props.partySize;
    this.notes = props.notes;
    this.createdAt = props.createdAt;
  }

  static create(
    props: NewRestaurantReservationProps,
  ): RestaurantReservationModel {
    return new RestaurantReservationModel({
      ...props,
      id: v4(),
      status: RestaurantReservationStatus.PENDING,
    });
  }

  static getDateError(input: {
    requestedDate: string;
    requestedTime: string;
    today: string;
    nowMinutes: number;
    stay: StayWindow;
  }): string | null {
    const { requestedDate, requestedTime, today, nowMinutes, stay } = input;

    if (requestedDate < today) return 'Esa fecha ya pasó.';
    if (requestedDate === today && toMinutes(requestedTime) <= nowMinutes) {
      return 'Ese horario ya pasó.';
    }
    if (requestedDate < stay.checkIn || requestedDate > stay.checkOut) {
      return 'Solo puedo pedir mesa para los días de tu estadía.';
    }
    return null;
  }

  changeStatus(next: RestaurantReservationStatus): string | null {
    if (!ALLOWED_TRANSITIONS[this.status].includes(next)) {
      return `No se puede pasar una solicitud de ${this.status} a ${next}`;
    }
    this.status = next;
    return null;
  }

  /** El ticket se carga sobre una mesa confirmada: una pendiente o rechazada no se consumió. */
  getTicketError(): string | null {
    return this.status === RestaurantReservationStatus.CONFIRMED
      ? null
      : 'Solo se puede cargar el ticket de una reserva de mesa confirmada';
  }

  getStatusNotice(): string | null {
    const [year, month, day] = this.requestedDate.split('-');
    const people =
      this.partySize === 1 ? '1 persona' : `${this.partySize} personas`;
    const slot = `del ${day}/${month}/${year} a las ${this.requestedTime} para ${people}`;

    if (this.status === RestaurantReservationStatus.CONFIRMED) {
      return `✅ Tu mesa en el restaurante ${slot} quedó confirmada. ¡Te esperamos!`;
    }
    if (this.status === RestaurantReservationStatus.REJECTED) {
      return `No pudimos confirmar tu mesa en el restaurante ${slot}. Si querés, buscamos otro horario.`;
    }
    return null;
  }
}
