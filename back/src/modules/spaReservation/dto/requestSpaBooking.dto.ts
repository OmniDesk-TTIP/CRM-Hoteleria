import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { toTrimmedString, trimString } from '../../../common/transforms';
import { isValidDateFormat } from '../../bookingProcess/date.util';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

@ValidatorConstraint({ name: 'isDateFormat', async: false })
class IsDateFormatConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidDateFormat(value);
  }

  defaultMessage(): string {
    return 'La fecha debe tener el formato DD-MM-YYYY y ser una fecha válida';
  }
}

/** Argumentos que arma el modelo al llamar a la tool `request_spa_booking`: no son de fiar. */
export class RequestSpaBookingDto {
  @IsString({ message: 'El servicio debe ser un identificador' })
  @IsNotEmpty({ message: 'Falta indicar el servicio' })
  @IsUUID('all', { message: 'El servicio indicado no es válido' })
  serviceId!: string;

  @Validate(IsDateFormatConstraint)
  date!: string;

  @Matches(TIME_REGEX, { message: 'La hora debe tener el formato HH:mm' })
  time!: string;

  /** Solo lo informa el cliente externo (el huésped ya está identificado por su reserva). */
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @MinLength(3, { message: 'El nombre completo es muy corto' })
  @MaxLength(150, { message: 'El nombre completo es demasiado largo' })
  fullName?: string;

  @IsOptional()
  @Transform(toTrimmedString)
  @Matches(/^\d{7,9}$/, {
    message: 'El DNI debe contener entre 7 y 9 dígitos numéricos',
  })
  dni?: string;
}
