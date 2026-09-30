import { Injectable } from '@nestjs/common';
import { DashboardRepository } from './dashboard.repository';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { AdminReservationDto } from '../reservation/dto/adminReservation.dto';
import { AuthUser } from '../auth/auth.types';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { RoomStatus } from '../../infrastructure/database/entities/Room.entity';
import {
  DashboardAttentionDto,
  DashboardOccupancyDto,
  DashboardRevenueDto,
  DashboardStatusDto,
  DashboardSummaryDto,
  OccupancyCellState,
} from './dto/dashboard.dto';
import {
  addDays,
  addMonths,
  daysInMonth,
  toDateKey,
  zonedDateKey,
} from './dashboard.util';

const OCCUPANCY_DAYS = 14;
const REVENUE_MONTHS = 12;
const UPCOMING_LIMIT = 6;

@Injectable()
export class DashboardService {
  constructor(
    private readonly dashboardRepository: DashboardRepository,
    private readonly supportHoursService: SupportHoursService,
  ) {}

  async getSummary(
    user: AuthUser,
    now: Date = new Date(),
  ): Promise<DashboardSummaryDto> {
    const today = zonedDateKey(now, this.supportHoursService.getTimeZone());

    const [attention, occupancy, upcoming, revenue, support] =
      await Promise.all([
        this.getAttention(user, today),
        this.getOccupancy(today),
        this.dashboardRepository.findUpcoming(today, UPCOMING_LIMIT),
        this.getRevenue(today),
        this.supportHoursService.getAvailability(now),
      ]);

    return {
      today,
      attention,
      occupancy,
      upcomingReservations: upcoming.map((reservation) =>
        AdminReservationDto.fromEntity(reservation),
      ),
      revenue,
      support,
    };
  }

  async getStatus(now: Date = new Date()): Promise<DashboardStatusDto> {
    const [waitingHuman, support] = await Promise.all([
      this.dashboardRepository.countWaitingHuman(),
      this.supportHoursService.getAvailability(now),
    ]);

    return { waitingHuman, support };
  }

  private async getAttention(
    user: AuthUser,
    today: string,
  ): Promise<DashboardAttentionDto> {
    const [waitingHuman, myActiveChats, pendingPayment, checkInsToday] =
      await Promise.all([
        this.dashboardRepository.countWaitingHuman(),
        this.dashboardRepository.countActiveChatsOf(user.id),
        this.dashboardRepository.countPendingPayment(),
        this.dashboardRepository.countCheckIns(today),
      ]);

    return { waitingHuman, myActiveChats, pendingPayment, checkInsToday };
  }

  private async getOccupancy(today: string): Promise<DashboardOccupancyDto> {
    const days = Array.from({ length: OCCUPANCY_DAYS }, (_, index) =>
      addDays(today, index),
    );
    const end = addDays(today, OCCUPANCY_DAYS);

    const [rooms, reservations] = await Promise.all([
      this.dashboardRepository.findDashboardRooms(),
      this.dashboardRepository.findLiveOverlapping(today, end),
    ]);

    const nightsByRoom = new Map<string, Map<string, OccupancyCellState>>();
    for (const reservation of reservations) {
      const state: OccupancyCellState =
        reservation.status === ReservationStatus.CONFIRMED
          ? 'booked'
          : 'pending';
      const checkIn = toDateKey(reservation.checkIn);
      const checkOut = toDateKey(reservation.checkOut);
      const roomNights =
        nightsByRoom.get(reservation.room.id) ??
        new Map<string, OccupancyCellState>();

      for (const day of days) {
        if (day >= checkIn && day < checkOut) roomNights.set(day, state);
      }
      nightsByRoom.set(reservation.room.id, roomNights);
    }

    let occupiedNights = 0;
    let availableNights = 0;

    const roomRows = rooms.map((room) => {
      const inMaintenance = room.status === RoomStatus.MAINTENANCE;
      const roomNights = nightsByRoom.get(room.id);

      const cells = days.map((day): OccupancyCellState => {
        if (inMaintenance) return 'maintenance';
        return roomNights?.get(day) ?? 'free';
      });

      if (!inMaintenance) {
        availableNights += cells.length;
        occupiedNights += cells.filter((cell) => cell !== 'free').length;
      }

      return {
        id: room.id,
        roomNumber: room.roomNumber,
        categoryName: room.category?.name ?? '',
        status: room.status,
        cells,
      };
    });

    return {
      days,
      rooms: roomRows,
      occupancyPct: percentage(occupiedNights, availableNights),
    };
  }

  private async getRevenue(today: string): Promise<DashboardRevenueDto> {
    const month = today.slice(0, 7);
    const firstMonth = addMonths(month, -(REVENUE_MONTHS - 1));
    const nextMonth = addMonths(month, 1);

    const [rows, monthNights, activeRooms] = await Promise.all([
      this.dashboardRepository.revenueByMonth(
        `${firstMonth}-01`,
        `${nextMonth}-01`,
      ),
      this.dashboardRepository.confirmedNightsBetween(
        `${month}-01`,
        `${nextMonth}-01`,
      ),
      this.dashboardRepository.countActiveRooms(),
    ]);

    const byMonthKey = new Map(rows.map((row) => [row.month, row]));
    const byMonth = Array.from({ length: REVENUE_MONTHS }, (_, index) => {
      const key = addMonths(firstMonth, index);
      return { month: key, total: round2(byMonthKey.get(key)?.total ?? 0) };
    });

    const current = byMonthKey.get(month);
    const monthTotal = round2(current?.total ?? 0);
    const adr =
      current && current.nights > 0
        ? round2(current.total / current.nights)
        : 0;

    return {
      month,
      monthTotal,
      adr,
      monthOccupancyPct: percentage(
        monthNights,
        activeRooms * daysInMonth(month),
      ),
      byMonth,
    };
  }
}

function percentage(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
