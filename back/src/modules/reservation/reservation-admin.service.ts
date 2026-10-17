import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReservationRepository } from './reservation.repository';
import {
  CancellationOutcome,
  CancellationService,
} from '../cancellation/cancellation.service';
import { RoomRepository } from '../room/room.repository';
import { Room } from '../../infrastructure/database/entities/Room.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { ListReservationsQueryDto } from './dto/listReservations.dto';
import { SaveReservationDto } from './dto/saveReservation.dto';
import {
  AdminReservationDto,
  PaginatedResultDto,
} from './dto/adminReservation.dto';

@Injectable()
export class ReservationAdminService {
  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly roomRepository: RoomRepository,
    private readonly cancellationService: CancellationService,
  ) {}

  async list(
    query: ListReservationsQueryDto,
  ): Promise<PaginatedResultDto<AdminReservationDto>> {
    const { items, total } = await this.reservationRepository.findManyPaginated(
      {
        status: query.status,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        page: query.page,
        pageSize: query.pageSize,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
    );

    return {
      data: items.map((item) => AdminReservationDto.fromEntity(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(payload: SaveReservationDto): Promise<AdminReservationDto> {
    const { room, checkIn, checkOut } =
      await this.validateAndResolveRoom(payload);

    const reservation = this.reservationRepository.createManual({
      room,
      guestFullName: payload.guestFullName,
      guestDni: payload.guestDni,
      checkIn,
      checkOut,
      status: payload.status,
      totalAmount: payload.totalAmount,
      depositAmount: payload.depositAmount,
    });

    await this.reservationRepository.saveNew(reservation);
    return AdminReservationDto.fromEntity(reservation);
  }

  async update(
    id: string,
    payload: SaveReservationDto,
  ): Promise<AdminReservationDto> {
    const reservation = await this.reservationRepository.findById(id);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    const { room, checkIn, checkOut } = await this.validateAndResolveRoom(
      payload,
      id,
    );

    const isCancelling =
      payload.status === ReservationStatus.CANCELLED &&
      reservation.status !== ReservationStatus.CANCELLED;

    await this.reservationRepository.applyUpdate(reservation, {
      room,
      guestFullName: payload.guestFullName,
      guestDni: payload.guestDni,
      checkIn,
      checkOut,
      status: isCancelling ? reservation.status : payload.status,
      totalAmount: payload.totalAmount,
      depositAmount: payload.depositAmount,
    });

    if (isCancelling) {
      await this.cancellationService.cancelReservation(id);
      const cancelled = await this.reservationRepository.findById(id, {
        refresh: true,
      });
      return AdminReservationDto.fromEntity(cancelled ?? reservation);
    }

    return AdminReservationDto.fromEntity(reservation);
  }

  async cancel(id: string): Promise<CancellationOutcome> {
    return this.cancellationService.cancelReservation(id);
  }

  private async validateAndResolveRoom(
    payload: SaveReservationDto,
    excludeReservationId?: string,
  ): Promise<{ room: Room; checkIn: Date; checkOut: Date }> {
    const checkIn = new Date(payload.checkIn);
    const checkOut = new Date(payload.checkOut);

    if (checkOut <= checkIn) {
      throw new BadRequestException(
        'La fecha de check-out debe ser posterior a la de check-in',
      );
    }

    const room = await this.roomRepository.findById(payload.roomId);
    if (!room)
      throw new NotFoundException('La habitación seleccionada no existe');

    const occupied = await this.reservationRepository.isRoomOccupied(
      payload.roomId,
      checkIn,
      checkOut,
      excludeReservationId,
    );
    if (occupied) {
      throw new ConflictException(
        'La habitación ya está ocupada para esas fechas',
      );
    }

    return { room, checkIn, checkOut };
  }
}
