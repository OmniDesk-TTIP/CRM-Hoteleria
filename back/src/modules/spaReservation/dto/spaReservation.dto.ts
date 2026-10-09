import { SpaReservationStatus } from '../../../infrastructure/database/entities/SpaReservation.entity';
import { SpaReservationModel } from '../spaReservation.model';

/** Respuesta del panel (`/spa-reservations`). */
export class SpaReservationDto {
  id: string;
  status: SpaReservationStatus;
  serviceName: string;
  guestFullName: string;
  requestedDate: string;
  requestedTime: string;
  createdAt: string | null;

  static fromModel(model: SpaReservationModel): SpaReservationDto {
    const dto = new SpaReservationDto();
    dto.id = model.id;
    dto.status = model.status;
    dto.serviceName = model.serviceName;
    dto.guestFullName = model.guestFullName;
    dto.requestedDate = model.requestedDate;
    dto.requestedTime = model.requestedTime;
    dto.createdAt = model.createdAt ? model.createdAt.toISOString() : null;
    return dto;
  }
}

export interface PaginatedSpaReservationsDto {
  items: SpaReservationDto[];
  total: number;
  page: number;
  pageSize: number;
}
