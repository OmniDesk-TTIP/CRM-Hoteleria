import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
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
}
