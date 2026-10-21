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
  /** YYYY-MM-DD */
  requestedDate: string;
  /** HH:mm */
  requestedTime: string;
  partySize: number;
  notes: string | null;
  createdAt?: Date;
}

export type NewRestaurantReservationProps = Omit<
  RestaurantReservationProps,
  'id' | 'status' | 'createdAt'
>;

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

/**
 * Regla de negocio de un pedido de mesa. Pura: sin DB ni ORM.
 * El repository la convierte desde y hacia la entidad.
 */
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

  /** Todo pedido arranca PENDING: nada queda confirmado hasta que recepción lo resuelve. */
  static create(
    props: NewRestaurantReservationProps,
  ): RestaurantReservationModel {
    return new RestaurantReservationModel({
      ...props,
      id: v4(),
      status: RestaurantReservationStatus.PENDING,
    });
  }

  /**
   * ¿La fecha y la hora pedidas son válidas? Devuelve el motivo (apto para mostrarle al
   * huésped) o null si está bien. Las fechas van en YYYY-MM-DD, así que comparar strings
   * equivale a comparar días. `today` y `nowMinutes` son de la zona horaria del hotel.
   * Solo se pide mesa durante la estadía (incluidos el día de entrada y el de salida).
   */
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

  /** Resolución desde el panel. Devuelve el motivo si no se pudo, o null si se aplicó. */
  changeStatus(next: RestaurantReservationStatus): string | null {
    if (!ALLOWED_TRANSITIONS[this.status].includes(next)) {
      return `No se puede pasar una solicitud de ${this.status} a ${next}`;
    }
    this.status = next;
    return null;
  }

  /** Aviso para el huésped cuando su pedido queda resuelto; null en los demás estados. */
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
