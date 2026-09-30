import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class UpdateSupportHoursDayDto {
  @Type(() => Number)
  @IsInt({ message: 'weekday debe ser un número entero' })
  @Min(0, { message: 'weekday debe estar entre 0 (domingo) y 6 (sábado)' })
  @Max(6, { message: 'weekday debe estar entre 0 (domingo) y 6 (sábado)' })
  weekday!: number;

  @IsBoolean({ message: 'isClosed debe ser booleano' })
  isClosed!: boolean;

  @Matches(TIME_REGEX, { message: 'opensAt debe tener formato HH:mm' })
  opensAt!: string;

  @Matches(TIME_REGEX, { message: 'closesAt debe tener formato HH:mm' })
  closesAt!: string;
}

export class UpdateSupportHoursDto {
  // La semana se reemplaza entera: es un PUT, no un PATCH por día. Así el panel manda lo que
  // muestra y no hay estados intermedios raros si el operador toca varios días de una.
  @IsArray({ message: 'days debe ser un arreglo' })
  @ArrayMinSize(7, { message: 'days tiene que traer los 7 días de la semana' })
  @ArrayMaxSize(7, { message: 'days tiene que traer los 7 días de la semana' })
  @ValidateNested({ each: true })
  @Type(() => UpdateSupportHoursDayDto)
  days!: UpdateSupportHoursDayDto[];
}
