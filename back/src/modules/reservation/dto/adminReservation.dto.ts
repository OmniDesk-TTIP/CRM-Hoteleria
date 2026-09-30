import { Reservation, ReservationOrigin, ReservationStatus } from '../../../infrastructure/database/entities/Reservation.entity';

export class AdminReservationDto {
  id!: string;
  guestFullName!: string;
  guestDni!: string;
  checkIn!: Date;
  checkOut!: Date;
  status!: ReservationStatus;
  origin!: ReservationOrigin;
  totalAmount!: number;
  depositAmount!: number;
  room!: {
    id: string;
    roomNumber: string;
    categoryName: string;
  };
  createdAt!: Date;

  static fromEntity(reservation: Reservation): AdminReservationDto {
    const dto = new AdminReservationDto();
    dto.id = reservation.id;
    dto.guestFullName = reservation.guestFullName;
    dto.guestDni = reservation.guestDni;
    dto.checkIn = reservation.checkIn;
    dto.checkOut = reservation.checkOut;
    dto.status = reservation.status;
    dto.origin = reservation.origin;
    dto.totalAmount = Number(reservation.totalAmount);
    dto.depositAmount = Number(reservation.depositAmount);
    dto.room = {
      id: reservation.room.id,
      roomNumber: reservation.room.roomNumber,
      categoryName: reservation.room.category?.name ?? '',
    };
    dto.createdAt = reservation.createdAt;
    return dto;
  }
}

export class PaginatedResultDto<T> {
  data!: T[];
  total!: number;
  page!: number;
  pageSize!: number;
}