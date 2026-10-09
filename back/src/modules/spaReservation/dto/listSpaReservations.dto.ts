import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SpaReservationStatus } from '../../../infrastructure/database/entities/SpaReservation.entity';

export class ListSpaReservationsQueryDto {
  @IsOptional()
  @IsIn(Object.values(SpaReservationStatus), { message: 'Estado inválido' })
  status?: SpaReservationStatus;

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
  @IsIn(['createdAt', 'requestedDate', 'status'], {
    message: 'sortBy inválido',
  })
  sortBy: 'createdAt' | 'requestedDate' | 'status' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortDir inválido' })
  sortDir: 'asc' | 'desc' = 'desc';
}
