import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  ChatSession,
  ChatSessionStatus,
} from '../../infrastructure/database/entities/ChatSession.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { keyToUtc } from './dashboard.util';

const LIVE_STATUSES = [
  ReservationStatus.PENDING_PAYMENT,
  ReservationStatus.CONFIRMED,
];

export interface MonthRevenueRow {
  month: string;
  total: number;
  nights: number;
}

/** Consultas de solo lectura para el dashboard. Los agregados van en SQL para no traer tablas enteras. */
@Injectable()
export class DashboardRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Mismo criterio que el filtro `pendingHandover` de la bandeja ("Requieren atención"), para que
   * el número del Home coincida con lo que se ve al hacer clic. Incluye el fallback de la IA,
   * que marca handoverRequestedAt sin pasar el chat a WAITING_HUMAN.
   */
  countWaitingHuman(): Promise<number> {
    return this.em.count(ChatSession, { handoverRequestedAt: { $ne: null } });
  }

  countActiveChatsOf(operatorId: string): Promise<number> {
    return this.em.count(ChatSession, {
      status: ChatSessionStatus.HUMAN,
      assignedOperator: operatorId,
    });
  }

  countPendingPayment(): Promise<number> {
    return this.em.count(Reservation, {
      status: ReservationStatus.PENDING_PAYMENT,
    });
  }

  countCheckIns(day: string): Promise<number> {
    return this.em.count(Reservation, {
      status: ReservationStatus.CONFIRMED,
      checkIn: keyToUtc(day),
    });
  }

  findDashboardRooms(): Promise<Room[]> {
    return this.em.find(
      Room,
      { status: { $in: [RoomStatus.ACTIVE, RoomStatus.MAINTENANCE] } },
      { populate: ['category'], orderBy: { roomNumber: 'asc' } },
    );
  }

  /** Reservas vivas que pisan el rango [from, to). La noche del check-out no ocupa la habitación. */
  findLiveOverlapping(from: string, to: string): Promise<Reservation[]> {
    return this.em.find(Reservation, {
      status: { $in: LIVE_STATUSES },
      $and: [
        { checkIn: { $lt: keyToUtc(to) } },
        { checkOut: { $gt: keyToUtc(from) } },
      ],
    });
  }

  findUpcoming(from: string, limit: number): Promise<Reservation[]> {
    return this.em.find(
      Reservation,
      { status: { $in: LIVE_STATUSES }, checkIn: { $gte: keyToUtc(from) } },
      {
        populate: ['room', 'room.category'],
        orderBy: { checkIn: 'asc', createdAt: 'asc' },
        limit,
      },
    );
  }

  /** Ingresos confirmados agrupados por mes de check-in, en el rango [from, to). */
  async revenueByMonth(from: string, to: string): Promise<MonthRevenueRow[]> {
    const rows = await this.em
      .getConnection()
      .execute<{ month: string; total: string; nights: string }[]>(
        `
      SELECT to_char(date_trunc('month', check_in), 'YYYY-MM') AS month,
             COALESCE(SUM(total_amount), 0) AS total,
             COALESCE(SUM(check_out - check_in), 0) AS nights
      FROM reservations
      WHERE status = ? AND check_in >= ?::date AND check_in < ?::date
      GROUP BY 1
      ORDER BY 1
      `,
        [ReservationStatus.CONFIRMED, from, to],
      );

    return rows.map((row) => ({
      month: row.month,
      total: Number(row.total),
      nights: Number(row.nights),
    }));
  }

  /** Noches confirmadas dentro de [from, to), recortando las estadías que cruzan los bordes. */
  async confirmedNightsBetween(from: string, to: string): Promise<number> {
    const [row] = await this.em.getConnection().execute<{ nights: string }[]>(
      `
      SELECT COALESCE(SUM(LEAST(check_out, ?::date) - GREATEST(check_in, ?::date)), 0) AS nights
      FROM reservations
      WHERE status = ? AND check_in < ?::date AND check_out > ?::date
      `,
      [to, from, ReservationStatus.CONFIRMED, to, from],
    );

    return Number(row?.nights ?? 0);
  }

  countActiveRooms(): Promise<number> {
    return this.em.count(Room, { status: RoomStatus.ACTIVE });
  }
}
