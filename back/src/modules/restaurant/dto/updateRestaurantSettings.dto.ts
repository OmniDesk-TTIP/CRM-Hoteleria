import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { toTrimmedString } from '../../../common/transforms';
import { RestaurantStatus } from '../../../infrastructure/database/entities/RestaurantSettings.entity';
import { TIME_REGEX } from '../../spa/dto/createSpaService.dto';
import { MAX_SHIFTS } from '../model/restaurant.model';

export class RestaurantShiftDto {
  @Matches(TIME_REGEX, { message: 'opensAt debe tener formato HH:mm' })
  opensAt!: string;

  @Matches(TIME_REGEX, { message: 'closesAt debe tener formato HH:mm' })
  closesAt!: string;
}

/** `PUT /restaurant`: reemplaza la información del restó (la crea si todavía no existe). */
export class UpdateRestaurantSettingsDto {
  @IsIn(Object.values(RestaurantStatus), { message: 'Estado inválido' })
  status!: RestaurantStatus;

  /** Vacío borra la descripción. */
  @IsOptional()
  @Transform(toTrimmedString)
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @MaxLength(1000, { message: 'La descripción es demasiado larga' })
  description?: string;

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

  @IsArray({ message: 'Las franjas horarias deben ser un arreglo' })
  @ArrayMinSize(1, { message: 'Indicá al menos una franja horaria' })
  @ArrayMaxSize(MAX_SHIFTS, {
    message: `No puede haber más de ${MAX_SHIFTS} franjas horarias`,
  })
  @ValidateNested({ each: true })
  @Type(() => RestaurantShiftDto)
  shifts!: RestaurantShiftDto[];

  @IsInt({ message: 'La cantidad máxima de personas debe ser un entero' })
  @Min(1, { message: 'La cantidad máxima de personas debe ser al menos 1' })
  @Max(50, { message: 'La cantidad máxima de personas no puede superar 50' })
  maxPartySize!: number;
}
