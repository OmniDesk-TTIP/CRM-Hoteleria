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
import { TIME_REGEX } from './createSpaService.dto';

export class UpdateSpaServiceDto {
  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name?: string;

  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La descripción no puede estar vacía' })
  @MaxLength(1000, { message: 'La descripción es demasiado larga' })
  description?: string;

  @IsOptional()
  @IsInt({ message: 'La duración debe ser un número entero de minutos' })
  @IsPositive({ message: 'La duración debe ser un valor positivo' })
  @Max(720, { message: 'La duración no puede superar las 12 horas' })
  durationMinutes?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El precio debe ser un número' })
  @IsPositive({ message: 'El precio debe ser un valor positivo' })
  price?: number;

  @IsOptional()
  @IsIn(Object.values(SpaServiceStatus), { message: 'Estado inválido' })
  status?: SpaServiceStatus;

  @IsOptional()
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
  availableWeekdays?: number[];

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'opensAt debe tener formato HH:mm' })
  opensAt?: string;

  @IsOptional()
  @Matches(TIME_REGEX, { message: 'closesAt debe tener formato HH:mm' })
  closesAt?: string;
}
