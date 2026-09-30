import { IsIn, IsInt, IsOptional, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ReservationStatus } from '../../../infrastructure/database/entities/Reservation.entity';

export class ListReservationsQueryDto {
  @IsOptional()
  @IsIn(Object.values(ReservationStatus), { message: 'Estado inválido' })
  status?: ReservationStatus;

  @IsOptional()
  @IsDateString({}, { message: 'dateFrom debe ser una fecha válida (YYYY-MM-DD)' })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({}, { message: 'dateTo debe ser una fecha válida (YYYY-MM-DD)' })
  dateTo?: string;

  // Los query params llegan como string; sin este @Type, @IsInt los rechaza directo.
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser mayor a 0' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize debe ser un número entero' })
  @Min(1, { message: 'pageSize debe ser mayor a 0' })
  @Max(100, { message: 'pageSize no puede superar 100' })
  pageSize: number = 10;

  @IsOptional()
  @IsIn(['checkIn', 'createdAt', 'status'], { message: 'sortBy inválido' })
  sortBy: 'checkIn' | 'createdAt' | 'status' = 'checkIn';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortDir inválido' })
  sortDir: 'asc' | 'desc' = 'desc';
}
