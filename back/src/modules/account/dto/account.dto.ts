import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../../common/transforms';
import {
  AccountStatus,
  PaymentMethod,
} from '../../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../../infrastructure/database/entities/AccountEntry.entity';
import { ReservationStatus } from '../../../infrastructure/database/entities/Reservation.entity';
import {
  AccountEntryModel,
  AccountModel,
  AccountReservationInfo,
  MAX_ENTRY_AMOUNT,
  MAX_ENTRY_DESCRIPTION_LENGTH,
  MAX_ENTRY_REFERENCE_LENGTH,
  stayBalanceOf,
} from '../account.model';

const PAYMENT_METHOD_MESSAGE =
  'El medio de pago debe ser CASH, CARD, TRANSFER o MERCADO_PAGO';

/** Body de `POST /reservations/:id/account`: registra el pago del resto de la estadía. */
export class OpenAccountDto {
  @IsIn(Object.values(PaymentMethod), { message: PAYMENT_METHOD_MESSAGE })
  paymentMethod!: PaymentMethod;
}

/** Monto de un pago o reintegro: positivo, con hasta dos decimales. */
class MoneyMovementDto {
  /**
   * UUID que genera el panel por cada confirmación. Si el pedido se reintenta con la misma clave,
   * no se registra otro movimiento.
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

  @IsIn(Object.values(PaymentMethod), { message: PAYMENT_METHOD_MESSAGE })
  paymentMethod!: PaymentMethod;
}

/** Body de `POST /reservations/:id/account/payments`. */
export class RegisterPaymentDto extends MoneyMovementDto {
  /** Número de operación, de cupón, etc. */
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'La referencia debe ser un texto' })
  @MaxLength(MAX_ENTRY_REFERENCE_LENGTH, {
    message: `La referencia no puede superar ${MAX_ENTRY_REFERENCE_LENGTH} caracteres`,
  })
  reference?: string;
}

/** Body de `POST /reservations/:id/account/refunds`. */
export class RegisterRefundDto extends MoneyMovementDto {
  @Transform(trimString)
  @IsString({ message: 'El motivo debe ser un texto' })
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(MAX_ENTRY_DESCRIPTION_LENGTH, {
    message: `El motivo no puede superar ${MAX_ENTRY_DESCRIPTION_LENGTH} caracteres`,
  })
  reason!: string;
}

/** Body de `POST /reservations/:id/account/payments/:entryId/reversal`. */
export class ReverseEntryDto {
  @Transform(trimString)
  @IsString({ message: 'El motivo debe ser un texto' })
  @IsNotEmpty({ message: 'El motivo es obligatorio' })
  @MaxLength(MAX_ENTRY_DESCRIPTION_LENGTH, {
    message: `El motivo no puede superar ${MAX_ENTRY_DESCRIPTION_LENGTH} caracteres`,
  })
  reason!: string;
}

export interface UserRefDto {
  id: string;
  fullName: string;
}

export class AccountEntryDto {
  id!: string;
  type!: AccountEntryType;
  amount!: number;
  description!: string;
  origin!: AccountEntryOrigin;
  sourceId!: string | null;
  /** Solo en pagos, reintegros y anulaciones de pagos. */
  paymentMethod!: PaymentMethod | null;
  /** Número de operación o de cupón del pago, si se cargó. */
  reference!: string | null;
  /** Movimiento que anula este, si es una anulación. */
  reversesId!: string | null;
  /** true si otro movimiento ya anuló a este. */
  reversed!: boolean;
  registeredAt!: Date;
  /** Null cuando lo registró Chamber. */
  registeredBy!: UserRefDto | null;

  static fromModel(entry: AccountEntryModel, reversed: boolean) {
    const dto = new AccountEntryDto();
    dto.id = entry.id;
    dto.type = entry.type;
    dto.amount = entry.amount;
    dto.description = entry.description;
    dto.origin = entry.origin;
    dto.sourceId = entry.sourceId;
    dto.paymentMethod = entry.paymentMethod;
    dto.reference = entry.reference;
    dto.reversesId = entry.reversesId;
    dto.reversed = reversed;
    dto.registeredAt = entry.registeredAt;
    dto.registeredBy = entry.registeredById
      ? { id: entry.registeredById, fullName: entry.registeredByName ?? '' }
      : null;
    return dto;
  }
}

export class AccountDto {
  id!: string;
  status!: AccountStatus;
  stayBalanceAmount!: number;
  stayBalancePaymentMethod!: PaymentMethod;
  openedAt!: Date;
  openedBy!: UserRefDto;
  closedAt!: Date | null;
  totalCharges!: number;
  totalPayments!: number;
  /** Positivo: el huésped debe; negativo: tiene saldo a favor. */
  balance!: number;
  /** Del más nuevo al más viejo. */
  entries!: AccountEntryDto[];

  static fromModel(account: AccountModel): AccountDto {
    const reversed = account.reversedEntryIds;
    const dto = new AccountDto();
    dto.id = account.id;
    dto.status = account.status;
    dto.stayBalanceAmount = account.stayBalanceAmount;
    dto.stayBalancePaymentMethod = account.stayBalancePaymentMethod;
    dto.openedAt = account.openedAt;
    dto.openedBy = {
      id: account.openedById,
      fullName: account.openedByName ?? '',
    };
    dto.closedAt = account.closedAt;
    Object.assign(dto, account.summary);
    dto.entries = [...account.entries]
      .reverse()
      .map((entry) => AccountEntryDto.fromModel(entry, reversed.has(entry.id)));
    return dto;
  }
}

/** Respuesta de `GET /reservations/:id/account`: la reserva y su cuenta, o null si no se abrió. */
export class ReservationAccountDto {
  reservation!: {
    id: string;
    status: ReservationStatus;
    guestFullName: string;
    guestDni: string;
    roomNumber: string;
    categoryName: string;
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    depositAmount: number;
    /** Lo que se cobra para abrir la cuenta: total − seña. */
    stayBalance: number;
  };
  account!: AccountDto | null;

  static from(
    reservation: AccountReservationInfo,
    account: AccountModel | null,
  ): ReservationAccountDto {
    const dto = new ReservationAccountDto();
    dto.reservation = {
      id: reservation.id,
      status: reservation.status,
      guestFullName: reservation.guestFullName,
      guestDni: reservation.guestDni,
      roomNumber: reservation.roomNumber,
      categoryName: reservation.categoryName,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      totalAmount: reservation.totalAmount,
      depositAmount: reservation.depositAmount,
      stayBalance: stayBalanceOf(reservation),
    };
    dto.account = account ? AccountDto.fromModel(account) : null;
    return dto;
  }
}
