import { Type } from 'class-transformer';
import { IsInt, Min, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { isValidDateFormat } from '../date.util';

@ValidatorConstraint({ name: 'isDateFormat', async: false })
class IsDateFormatConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidDateFormat(value);
  }

  defaultMessage(): string {
    return 'La fecha debe tener el formato DD-MM-YYYY y ser una fecha válida';
  }
}

export class SearchAvailabilityDto {
  @Validate(IsDateFormatConstraint)
  checkIn!: string;

  @Validate(IsDateFormatConstraint)
  checkOut!: string;

  @Type(() => Number)
  @IsInt({ message: 'La capacidad debe ser un número entero' })
  @Min(1, { message: 'La capacidad debe ser mayor a 0' })
  capacity!: number;
}
