import { Reservation } from '../../../infrastructure/database/entities/Reservation.entity';

export class ReservationSummaryDto {
  id: string;
  checkIn: Date;
  checkOut: Date;
  roomCategoryName: string;
  guestFullName: string;
  totalAmount: number;
  depositAmount: number;
  status: string;
  initPoint: string | null;

  static fromEntity(reservation: Reservation): ReservationSummaryDto {
    const dto = new ReservationSummaryDto();
    dto.id = reservation.id;
    dto.checkIn = reservation.checkIn;
    dto.checkOut = reservation.checkOut;
    dto.roomCategoryName = reservation.room.category?.name ?? '';
    dto.guestFullName = reservation.guestFullName;
    dto.totalAmount = Number(reservation.totalAmount);
    dto.depositAmount = Number(reservation.depositAmount);
    dto.status = reservation.status;
    dto.initPoint = reservation.mpInitPoint ?? null;
    return dto;
  }
}
