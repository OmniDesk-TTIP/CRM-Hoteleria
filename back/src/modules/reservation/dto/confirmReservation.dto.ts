import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { toTrimmedString, trimString } from '../../../common/transforms';

export class ConfirmReservationDto {
  @Transform(trimString)
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre completo no puede estar vacío' })
  @MinLength(3, { message: 'El nombre completo es muy corto' })
  @MaxLength(150, { message: 'El nombre completo es demasiado largo' })
  fullName!: string;

  @Transform(toTrimmedString)
  @Matches(/^\d{7,9}$/, {
    message: 'El DNI debe contener entre 7 y 9 dígitos numéricos',
  })
  dni!: string;
}
