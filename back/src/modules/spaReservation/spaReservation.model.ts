import { v4 } from 'uuid';
import { StayWindow } from '../spa/model/spa.model';
import { SpaReservationStatus } from '../../infrastructure/database/entities/SpaReservation.entity';

export interface SpaReservationProps {
  id: string;
  status: SpaReservationStatus;
  telegramUserId: string;
  roomReservationId: string;
  spaServiceId: string;
  serviceName: string;
  guestFullName: string;
  requestedDate: string;
  requestedTime: string;
  createdAt?: Date;
}

export type NewSpaReservationProps = Omit<
  SpaReservationProps,
  'id' | 'status' | 'createdAt'
>;

const ALLOWED_TRANSITIONS: Record<
  SpaReservationStatus,
  SpaReservationStatus[]
> = {
  [SpaReservationStatus.PENDING]: [
    SpaReservationStatus.CONFIRMED,
    SpaReservationStatus.REJECTED,
  ],
  [SpaReservationStatus.CONFIRMED]: [],
  [SpaReservationStatus.REJECTED]: [],
};

export class SpaReservationModel {
  readonly id: string;
  status: SpaReservationStatus;
  readonly telegramUserId: string;
  readonly roomReservationId: string;
  readonly spaServiceId: string;
  readonly serviceName: string;
  readonly guestFullName: string;
  readonly requestedDate: string;
  readonly requestedTime: string;
  readonly createdAt?: Date;

  constructor(props: SpaReservationProps) {
    this.id = props.id;
    this.status = props.status;
    this.telegramUserId = props.telegramUserId;
    this.roomReservationId = props.roomReservationId;
    this.spaServiceId = props.spaServiceId;
    this.serviceName = props.serviceName;
    this.guestFullName = props.guestFullName;
    this.requestedDate = props.requestedDate;
    this.requestedTime = props.requestedTime;
    this.createdAt = props.createdAt;
  }

  static create(props: NewSpaReservationProps): SpaReservationModel {
    return new SpaReservationModel({
      ...props,
      id: v4(),
      status: SpaReservationStatus.PENDING,
    });
  }

  static getDateError(
    requestedDate: string,
    today: string,
    stay: StayWindow,
  ): string | null {
    if (requestedDate < today) return 'Esa fecha ya pasó.';
    if (requestedDate < stay.checkIn || requestedDate > stay.checkOut) {
      return 'Solo puedo tomar turnos durante tu estadía.';
    }
    return null;
  }

  canTransitionTo(next: SpaReservationStatus): boolean {
    return ALLOWED_TRANSITIONS[this.status].includes(next);
  }

  changeStatus(next: SpaReservationStatus): string | null {
    if (!this.canTransitionTo(next)) {
      return `No se puede pasar una solicitud de ${this.status} a ${next}`;
    }
    this.status = next;
    return null;
  }

  /** Aviso para el huésped cuando recepción resuelve el turno; null mientras sigue pendiente. */
  getStatusNotice(): string | null {
    const [year, month, day] = this.requestedDate.split('-');
    const slot = `del ${day}/${month}/${year} a las ${this.requestedTime}`;

    if (this.status === SpaReservationStatus.CONFIRMED) {
      return `✅ Tu turno de ${this.serviceName} ${slot} quedó confirmado. ¡Te esperamos!`;
    }
    if (this.status === SpaReservationStatus.REJECTED) {
      return `No pudimos confirmar tu turno de ${this.serviceName} ${slot}. Si querés, elegimos otro horario.`;
    }
    return null;
  }
}
