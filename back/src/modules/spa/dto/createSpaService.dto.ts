import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { toTrimmedString } from '../../../common/transforms';
import { SpaServiceStatus } from '../../../infrastructure/database/entities/SpaService.entity';

export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateSpaServiceDto {
  @Transform(toTrimmedString)
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name!: string;

  @Transform(toTrimmedString)
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La descripción no puede estar vacía' })
  @MaxLength(1000, { message: 'La descripción es demasiado larga' })
  description!: string;

  @IsInt({ message: 'La duración debe ser un número entero de minutos' })
  @IsPositive({ message: 'La duración debe ser un valor positivo' })
  @Max(720, { message: 'La duración no puede superar las 12 horas' })
  durationMinutes!: number;

  @IsNumber({}, { message: 'El precio debe ser un número' })
  @IsPositive({ message: 'El precio debe ser un valor positivo' })
  price!: number;

  @IsOptional()
  @IsIn(Object.values(SpaServiceStatus), { message: 'Estado inválido' })
  status?: SpaServiceStatus;

  @IsArray({ message: 'Los días disponibles deben ser un arreglo' })
  @ArrayMinSize(1, { message: 'Indicá al menos un día disponible' })
  @ArrayMaxSize(7, { message: 'No puede haber más de 7 días disponibles' })
  @IsInt({
    each: true,
    message: 'Cada día debe estar entre 0 (domingo) y 6 (sábado)',
  })
  @Min(0, {
    each: true,
    message: 'Cada día debe estar entre 0 (domingo) y 6 (sábado)',
  })
  @Max(6, {
    each: true,
    message: 'Cada día debe estar entre 0 (domingo) y 6 (sábado)',
  })
  availableWeekdays!: number[];

  @Matches(TIME_REGEX, { message: 'opensAt debe tener formato HH:mm' })
  opensAt!: string;

  @Matches(TIME_REGEX, { message: 'closesAt debe tener formato HH:mm' })
  closesAt!: string;
}
