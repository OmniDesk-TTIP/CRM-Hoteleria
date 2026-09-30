import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ReservationRepository } from './reservation.repository';
import { RoomRepository } from '../room/room.repository';
import { Room } from '../../infrastructure/database/entities/Room.entity';
import { ListReservationsQueryDto } from './dto/listReservations.dto';
import { SaveReservationDto } from './dto/saveReservation.dto';
import { AdminReservationDto, PaginatedResultDto } from './dto/adminReservation.dto';

@Injectable()
export class ReservationAdminService {
  constructor(
    private readonly reservationRepository: ReservationRepository,
    private readonly roomRepository: RoomRepository,
  ) {}

  async list(query: ListReservationsQueryDto): Promise<PaginatedResultDto<AdminReservationDto>> {
    const { items, total } = await this.reservationRepository.findManyPaginated({
      status: query.status,
      dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
      dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

    return {
      data: items.map((item) => AdminReservationDto.fromEntity(item)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(payload: SaveReservationDto): Promise<AdminReservationDto> {
    const { room, checkIn, checkOut } = await this.validateAndResolveRoom(payload);

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

  async update(id: string, payload: SaveReservationDto): Promise<AdminReservationDto> {
    const reservation = await this.reservationRepository.findById(id);
    if (!reservation) throw new NotFoundException('Reserva no encontrada');

    const { room, checkIn, checkOut } = await this.validateAndResolveRoom(payload, id);

    await this.reservationRepository.applyUpdate(reservation, {
      room,
      guestFullName: payload.guestFullName,
      guestDni: payload.guestDni,
      checkIn,
      checkOut,
      status: payload.status,
      totalAmount: payload.totalAmount,
      depositAmount: payload.depositAmount,
    });

    return AdminReservationDto.fromEntity(reservation);
  }

  /** CA5: cancelación segura. Es idempotente a propósito (una doble confirmación no debe fallar). */
  async cancel(id: string): Promise<void> {
    const cancelled = await this.reservationRepository.cancel(id);
    if (cancelled) return;

    const exists = await this.reservationRepository.findById(id);
    if (!exists) throw new NotFoundException('Reserva no encontrada');
    // Si existe pero no se pudo cancelar es porque ya estaba cancelada: no hay nada más que hacer.
  }

  /** CA3: valida fechas y que la habitación elegida esté libre en ese rango antes de guardar. */
  private async validateAndResolveRoom(
    payload: SaveReservationDto,
    excludeReservationId?: string,
  ): Promise<{ room: Room; checkIn: Date; checkOut: Date }> {
    const checkIn = new Date(payload.checkIn);
    const checkOut = new Date(payload.checkOut);

    if (checkOut <= checkIn) {
      throw new BadRequestException('La fecha de check-out debe ser posterior a la de check-in');
    }

    const room = await this.roomRepository.findById(payload.roomId);
    if (!room) throw new NotFoundException('La habitación seleccionada no existe');

    const occupied = await this.reservationRepository.isRoomOccupied(
      payload.roomId,
      checkIn,
      checkOut,
      excludeReservationId,
    );
    if (occupied) {
      throw new ConflictException('La habitación ya está ocupada para esas fechas');
    }

    return { room, checkIn, checkOut };
  }
}
