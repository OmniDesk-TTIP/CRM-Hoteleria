import {
  RefundStatus,
  Reservation,
  ReservationOrigin,
  ReservationStatus,
} from '../../../infrastructure/database/entities/Reservation.entity';

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
  cancelledAt!: Date | null;
  cancellationPolicyName!: string | null;
  refundPercentage!: number | null;
  refundAmount!: number | null;
  refundStatus!: RefundStatus | null;
  refundAccountAlias!: string | null;
  refundAccountHolder!: string | null;

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
    dto.cancelledAt = reservation.cancelledAt ?? null;
    dto.cancellationPolicyName = reservation.cancellationPolicyName ?? null;
    dto.refundPercentage =
      reservation.refundPercentage != null
        ? Number(reservation.refundPercentage)
        : null;
    dto.refundAmount =
      reservation.refundAmount != null
        ? Number(reservation.refundAmount)
        : null;
    dto.refundStatus = reservation.refundStatus ?? null;
    dto.refundAccountAlias = reservation.refundAccountAlias ?? null;
    dto.refundAccountHolder = reservation.refundAccountHolder ?? null;
    return dto;
  }
}

export class PaginatedResultDto<T> {
  data!: T[];
  total!: number;
  page!: number;
  pageSize!: number;
}
