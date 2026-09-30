import { Injectable } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/core';
import { Reservation, ReservationOrigin, ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { Room } from '../../infrastructure/database/entities/Room.entity';

interface CreateReservationData {
  room: Room;
  telegramUserId: string;
  checkIn: Date;
  checkOut: Date;
  totalAmount: number;
  depositAmount: number;
  guestFullName: string;
  guestDni: string;
}

interface AdminReservationFilters {
  status?: ReservationStatus;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
  pageSize: number;
  sortBy: 'checkIn' | 'createdAt' | 'status';
  sortDir: 'asc' | 'desc';
}

interface ManualReservationData {
  room: Room;
  guestFullName: string;
  guestDni: string;
  checkIn: Date;
  checkOut: Date;
  status: ReservationStatus;
  totalAmount: number;
  depositAmount: number;
}

@Injectable()
export class ReservationRepository {
  constructor(private readonly em: EntityManager) {}

  async findOverlapping(checkIn: Date, checkOut: Date): Promise<Reservation[]> {
    return this.em.find(Reservation, {
      status: { $in: [ReservationStatus.PENDING_PAYMENT, ReservationStatus.CONFIRMED] },
      $and: [{ checkIn: { $lt: checkOut } }, { checkOut: { $gt: checkIn } }],
    }, { populate: ['room'] });
  }

  create(data: CreateReservationData): Reservation {
    return this.em.create(Reservation, { ...data, status: ReservationStatus.PENDING_PAYMENT });
  }

  persist(reservation: Reservation): void {
    this.em.persist(reservation);
  }

  async findManyPaginated(filters: AdminReservationFilters): Promise<{ items: Reservation[]; total: number }> {
    const where: FilterQuery<Reservation> = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.dateFrom ? { checkIn: { $gte: filters.dateFrom } } : {}),
      ...(filters.dateTo ? { checkOut: { $lte: filters.dateTo } } : {}),
    };

    const [items, total] = await this.em.findAndCount(Reservation, where, {
      populate: ['room', 'room.category'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- clave de orden dinámica según sortBy
      orderBy: { [filters.sortBy]: filters.sortDir } as any,
      limit: filters.pageSize,
      offset: (filters.page - 1) * filters.pageSize,
    });

    return { items, total };
  }

  async findById(id: string): Promise<Reservation | null> {
    return this.em.findOne(Reservation, { id }, { populate: ['room', 'room.category'] });
  }

  async isRoomOccupied(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeReservationId?: string,
  ): Promise<boolean> {
    const count = await this.em.count(Reservation, {
      room: roomId,
      status: { $in: [ReservationStatus.PENDING_PAYMENT, ReservationStatus.CONFIRMED] },
      $and: [{ checkIn: { $lt: checkOut } }, { checkOut: { $gt: checkIn } }],
      ...(excludeReservationId ? { id: { $ne: excludeReservationId } } : {}),
    });

    return count > 0;
  }

  createManual(data: ManualReservationData): Reservation {
    return this.em.create(Reservation, { ...data, origin: ReservationOrigin.MANUAL });
  }

  async saveNew(reservation: Reservation): Promise<void> {
    this.em.persist(reservation);
    await this.em.flush();
  }

  async applyUpdate(reservation: Reservation, data: ManualReservationData): Promise<void> {
    reservation.room = data.room;
    reservation.guestFullName = data.guestFullName;
    reservation.guestDni = data.guestDni;
    reservation.checkIn = data.checkIn;
    reservation.checkOut = data.checkOut;
    reservation.status = data.status;
    reservation.totalAmount = data.totalAmount;
    reservation.depositAmount = data.depositAmount;
    await this.em.flush();
  }

  async cancel(id: string): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      Reservation,
      { id, status: { $ne: ReservationStatus.CANCELLED } },
      { status: ReservationStatus.CANCELLED },
    );

    return affected === 1;
  }
}