import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { trimString } from '../../../common/transforms';
import { isValidDateFormat } from '../../bookingProcess/date.util';
import { TIME_REGEX } from '../../spa/dto/createSpaService.dto';
import { RestaurantReservationStatus } from '../../../infrastructure/database/entities/RestaurantReservation.entity';
import {
  MAX_TICKET_DETAIL_LENGTH,
  MAX_TICKET_NUMBER_LENGTH,
  RestaurantReservationModel,
} from '../restaurantReservation.model';
import { MAX_ENTRY_AMOUNT } from '../../account/account.model';

@ValidatorConstraint({ name: 'isDateFormat', async: false })
class IsDateFormatConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isValidDateFormat(value);
  }

  defaultMessage(): string {
    return 'La fecha debe tener el formato DD-MM-YYYY y ser una fecha válida';
  }
}

export class RequestTableBookingDto {
  @Validate(IsDateFormatConstraint)
  date!: string;

  @Matches(TIME_REGEX, { message: 'La hora debe tener el formato HH:mm' })
  time!: string;

  @Type(() => Number)
  @IsInt({ message: 'La cantidad de personas debe ser un número entero' })
  @Min(1, { message: 'La mesa tiene que ser para al menos 1 persona' })
  @Max(100, { message: 'La cantidad de personas es demasiado alta' })
  partySize!: number;

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'El comentario debe ser una cadena de texto' })
  @MaxLength(300, { message: 'El comentario es demasiado largo' })
  notes?: string;
}

export class ListRestaurantReservationsQueryDto {
  @IsOptional()
  @IsIn(Object.values(RestaurantReservationStatus), {
    message: 'Estado inválido',
  })
  status?: RestaurantReservationStatus;

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

export class UpdateRestaurantReservationStatusDto {
  // Un pedido solo se resuelve: volver a PENDING no es una acción válida.
  @IsIn(
    [
      RestaurantReservationStatus.CONFIRMED,
      RestaurantReservationStatus.REJECTED,
    ],
    { message: 'El estado debe ser CONFIRMED o REJECTED' },
  )
  status!:
    | RestaurantReservationStatus.CONFIRMED
    | RestaurantReservationStatus.REJECTED;
}

export class RestaurantReservationDto {
  id: string;
  status: RestaurantReservationStatus;
  guestFullName: string;
  requestedDate: string;
  requestedTime: string;
  partySize: number;
  notes: string | null;
  createdAt: string | null;

  static fromModel(
    model: RestaurantReservationModel,
  ): RestaurantReservationDto {
    const dto = new RestaurantReservationDto();
    dto.id = model.id;
    dto.status = model.status;
    dto.guestFullName = model.guestFullName;
    dto.requestedDate = model.requestedDate;
    dto.requestedTime = model.requestedTime;
    dto.partySize = model.partySize;
    dto.notes = model.notes;
    dto.createdAt = model.createdAt ? model.createdAt.toISOString() : null;
    return dto;
  }
}

export interface PaginatedRestaurantReservationsDto {
  items: RestaurantReservationDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Body de `POST /restaurant-reservations/:id/tickets` (US-27): el ticket del restó a la cuenta. */
export class ChargeRestaurantTicketDto {
  /**
   * UUID que genera el panel por cada ticket confirmado. Si el pedido se reintenta con la misma
   * clave, no se carga otro cargo.
   */
  @IsUUID('4', { message: 'La clave de operación debe ser un UUID' })
  operationId!: string;

  // class-validator corre los decoradores de abajo hacia arriba: IsNumber va último para que un
  // monto que no es número no termine avisando "demasiado grande".
  @Max(MAX_ENTRY_AMOUNT, { message: 'El monto es demasiado grande' })
  @Min(0.01, { message: 'El monto tiene que ser mayor a cero' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 },
    { message: 'El monto debe ser un número con hasta dos decimales' },
  )
  amount!: number;

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'El número de ticket debe ser un texto' })
  @MaxLength(MAX_TICKET_NUMBER_LENGTH, {
    message: `El número de ticket no puede superar ${MAX_TICKET_NUMBER_LENGTH} caracteres`,
  })
  ticketNumber?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'El detalle debe ser un texto' })
  @MaxLength(MAX_TICKET_DETAIL_LENGTH, {
    message: `El detalle no puede superar ${MAX_TICKET_DETAIL_LENGTH} caracteres`,
  })
  detail?: string;
}
