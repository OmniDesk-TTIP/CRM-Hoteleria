import { RoomStatus } from '../../../infrastructure/database/entities/Room.entity';
import { AdminReservationDto } from '../../reservation/dto/adminReservation.dto';

export type OccupancyCellState = 'free' | 'booked' | 'pending' | 'maintenance';

export class DashboardAttentionDto {
  /** Chats con handover pendiente: el huésped o el fallback de la IA pidieron un humano. */
  waitingHuman!: number;
  /** Chats en HUMAN asignados al usuario que consulta. */
  myActiveChats!: number;
  pendingPayment!: number;
  checkInsToday!: number;
}

export class OccupancyRoomDto {
  id!: string;
  roomNumber!: string;
  categoryName!: string;
  status!: RoomStatus;
  /** Un estado por cada día de `DashboardOccupancyDto.days`. */
  cells!: OccupancyCellState[];
}

export class DashboardOccupancyDto {
  days!: string[];
  rooms!: OccupancyRoomDto[];
  /** Noches ocupadas (confirmadas o pendientes de pago) sobre noches disponibles de habitaciones activas. */
  occupancyPct!: number;
}

export class RevenueMonthDto {
  month!: string;
  total!: number;
}

export class DashboardRevenueDto {
  month!: string;
  monthTotal!: number;
  /** Tarifa promedio por noche vendida en el mes (ADR). */
  adr!: number;
  monthOccupancyPct!: number;
  byMonth!: RevenueMonthDto[];
}

export class DashboardSupportDto {
  isOpen!: boolean;
  nextOpeningLabel!: string | null;
}

/** Datos livianos para el layout (badge de chats y barra de estado), que se piden en cada página. */
export class DashboardStatusDto {
  waitingHuman!: number;
  support!: DashboardSupportDto;
}

export class DashboardSummaryDto {
  today!: string;
  attention!: DashboardAttentionDto;
  occupancy!: DashboardOccupancyDto;
  upcomingReservations!: AdminReservationDto[];
  revenue!: DashboardRevenueDto;
  support!: DashboardSupportDto;
}
