import { v4 } from 'uuid';
import { round2 } from '../../common/number.util';
import {
  AccountStatus,
  PaymentMethod,
} from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';

/** Lo que entra en un decimal(12,2). */
export const MAX_ENTRY_AMOUNT = 9_999_999_999.99;
export const MAX_ENTRY_DESCRIPTION_LENGTH = 200;
export const MAX_ENTRY_REFERENCE_LENGTH = 100;

/** Tipos que se cargan directo. Las anulaciones solo nacen de `AccountEntryModel.reversalOf`. */
export const DIRECT_ENTRY_TYPES = [
  AccountEntryType.CHARGE,
  AccountEntryType.PAYMENT,
  AccountEntryType.REFUND,
] as const;
export type DirectEntryType = (typeof DIRECT_ENTRY_TYPES)[number];

/** Qué anulación le corresponde a cada tipo. Una anulación o un reintegro no se anulan. */
const REVERSAL_TYPE: Partial<Record<AccountEntryType, AccountEntryType>> = {
  [AccountEntryType.CHARGE]: AccountEntryType.CHARGE_REVERSAL,
  [AccountEntryType.PAYMENT]: AccountEntryType.PAYMENT_REVERSAL,
};

/** Movimientos que mueven plata con el huésped: llevan medio de pago. */
const MONEY_TYPES: AccountEntryType[] = [
  AccountEntryType.PAYMENT,
  AccountEntryType.PAYMENT_REVERSAL,
  AccountEntryType.REFUND,
];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'efectivo',
  [PaymentMethod.CARD]: 'tarjeta',
  [PaymentMethod.TRANSFER]: 'transferencia',
  [PaymentMethod.MERCADO_PAGO]: 'Mercado Pago',
};

/** Descripción con la que queda en el libro un pago registrado en recepción. */
export const paymentDescription = (method: PaymentMethod): string =>
  `Pago en ${PAYMENT_METHOD_LABELS[method]}`;

const formatAmount = (amount: number): string =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Signs = Partial<Record<AccountEntryType, 1 | -1>>;

const CHARGE_SIGNS: Signs = {
  [AccountEntryType.CHARGE]: 1,
  [AccountEntryType.CHARGE_REVERSAL]: -1,
};

/** El reintegro descuenta de lo cobrado: es plata que el hotel le devuelve al huésped. */
const PAYMENT_SIGNS: Signs = {
  [AccountEntryType.PAYMENT]: 1,
  [AccountEntryType.PAYMENT_REVERSAL]: -1,
  [AccountEntryType.REFUND]: -1,
};

/** Se suma en centavos enteros: sumar decimales en float arrastra errores de redondeo. */
const toCents = (amount: number): number => Math.round(amount * 100);

// tolerancia por float: 10.1 * 100 da 1009.9999999999999
const hasTwoDecimals = (amount: number): boolean =>
  Math.abs(amount * 100 - toCents(amount)) < 1e-6;

/** Quién registró un movimiento: un usuario del panel o Chamber (`userId` null). */
export interface EntryAuthor {
  userId: string | null;
  userName?: string | null;
}

export interface AccountEntryProps {
  id: string;
  accountId: string;
  type: AccountEntryType;
  amount: number;
  description: string;
  origin: AccountEntryOrigin;
  sourceId: string | null;
  paymentMethod: PaymentMethod | null;
  reference: string | null;
  reversesId: string | null;
  registeredAt: Date;
  registeredById: string | null;
  registeredByName: string | null;
}

export interface NewEntryData {
  type: DirectEntryType;
  amount: number;
  description: string;
  origin: AccountEntryOrigin;
  sourceId?: string | null;
  /** Obligatorio en pagos y reintegros; un cargo no lleva. */
  paymentMethod?: PaymentMethod | null;
  reference?: string | null;
}

/** Movimiento del libro. Inmutable: no tiene métodos que lo modifiquen. */
export class AccountEntryModel {
  readonly id: string;
  readonly accountId: string;
  readonly type: AccountEntryType;
  readonly amount: number;
  readonly description: string;
  readonly origin: AccountEntryOrigin;
  readonly sourceId: string | null;
  readonly paymentMethod: PaymentMethod | null;
  readonly reference: string | null;
  readonly reversesId: string | null;
  readonly registeredAt: Date;
  readonly registeredById: string | null;
  readonly registeredByName: string | null;

  constructor(props: AccountEntryProps) {
    this.id = props.id;
    this.accountId = props.accountId;
    this.type = props.type;
    this.amount = props.amount;
    this.description = props.description;
    this.origin = props.origin;
    this.sourceId = props.sourceId;
    this.paymentMethod = props.paymentMethod;
    this.reference = props.reference;
    this.reversesId = props.reversesId;
    this.registeredAt = props.registeredAt;
    this.registeredById = props.registeredById;
    this.registeredByName = props.registeredByName;
  }

  static create(
    accountId: string,
    data: NewEntryData,
    author: EntryAuthor,
    now: Date,
  ): AccountEntryModel {
    return new AccountEntryModel({
      id: v4(),
      accountId,
      type: data.type,
      amount: data.amount,
      description: data.description,
      origin: data.origin,
      sourceId: data.sourceId ?? null,
      paymentMethod: data.paymentMethod ?? null,
      reference: data.reference?.trim() || null,
      reversesId: null,
      registeredAt: now,
      registeredById: author.userId,
      registeredByName: author.userName ?? null,
    });
  }

  /**
   * La anulación copia monto, origen, medio de pago y referencias del original; la descripción es
   * el motivo.
   */
  static reversalOf(
    original: AccountEntryModel,
    reason: string,
    author: EntryAuthor,
    now: Date,
  ): AccountEntryModel {
    const type = REVERSAL_TYPE[original.type];
    if (!type) {
      throw new Error(`Un movimiento ${original.type} no se puede anular`);
    }
    return new AccountEntryModel({
      id: v4(),
      accountId: original.accountId,
      type,
      amount: original.amount,
      description: reason,
      origin: original.origin,
      sourceId: original.sourceId,
      paymentMethod: original.paymentMethod,
      reference: original.reference,
      reversesId: original.id,
      registeredAt: now,
      registeredById: author.userId,
      registeredByName: author.userName ?? null,
    });
  }

  get isReversible(): boolean {
    return REVERSAL_TYPE[this.type] !== undefined;
  }

  getError(): string | null {
    if (!Number.isFinite(this.amount) || this.amount <= 0) {
      return 'El monto tiene que ser mayor a cero';
    }
    if (this.amount > MAX_ENTRY_AMOUNT) {
      return 'El monto es demasiado grande';
    }
    if (!hasTwoDecimals(this.amount)) {
      return 'El monto no puede tener más de dos decimales';
    }
    const description = this.description.trim();
    if (!description) return 'La descripción no puede estar vacía';
    if (description.length > MAX_ENTRY_DESCRIPTION_LENGTH) {
      return `La descripción no puede superar ${MAX_ENTRY_DESCRIPTION_LENGTH} caracteres`;
    }
    const movesMoney = MONEY_TYPES.includes(this.type);
    if (movesMoney && !this.paymentMethod) return 'Falta el medio de pago';
    if (!movesMoney && this.paymentMethod) {
      return 'Un cargo no lleva medio de pago';
    }
    if ((this.reference?.length ?? 0) > MAX_ENTRY_REFERENCE_LENGTH) {
      return `La referencia no puede superar ${MAX_ENTRY_REFERENCE_LENGTH} caracteres`;
    }
    return null;
  }
}

export interface AccountSummary {
  /** Cargos menos anulaciones de cargos. */
  totalCharges: number;
  /** Pagos menos anulaciones de pagos y reintegros: lo que el hotel efectivamente se quedó. */
  totalPayments: number;
  /** totalCharges − totalPayments. Positivo: el huésped debe. */
  balance: number;
}

/** El saldo se calcula siempre a partir de los movimientos; nunca se guarda. */
export function summarizeEntries(
  entries: Pick<AccountEntryModel, 'type' | 'amount'>[],
): AccountSummary {
  const sumCents = (signs: Signs) =>
    entries.reduce(
      (total, entry) =>
        total + (signs[entry.type] ?? 0) * toCents(entry.amount),
      0,
    );

  const chargesCents = sumCents(CHARGE_SIGNS);
  const paymentsCents = sumCents(PAYMENT_SIGNS);

  return {
    totalCharges: chargesCents / 100,
    totalPayments: paymentsCents / 100,
    balance: (chargesCents - paymentsCents) / 100,
  };
}

export interface AccountProps {
  id: string;
  reservationId: string;
  status: AccountStatus;
  stayBalanceAmount: number;
  stayBalancePaymentMethod: PaymentMethod;
  openedById: string;
  openedByName: string | null;
  openedAt: Date;
  closedAt: Date | null;
  entries: AccountEntryModel[];
}

/** Lo mínimo de la reserva que hace falta para abrirle la cuenta. */
export interface ReservationForAccount {
  id: string;
  status: ReservationStatus;
  totalAmount: number;
  depositAmount: number;
}

/** Datos de la reserva que acompañan a la cuenta en el panel. */
export interface AccountReservationInfo extends ReservationForAccount {
  guestFullName: string;
  guestDni: string;
  roomNumber: string;
  categoryName: string;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD */
  checkOut: string;
}

/** Cuenta corriente de una reserva con sus movimientos. */
export class AccountModel {
  readonly id: string;
  readonly reservationId: string;
  readonly status: AccountStatus;
  readonly stayBalanceAmount: number;
  readonly stayBalancePaymentMethod: PaymentMethod;
  readonly openedById: string;
  readonly openedByName: string | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly entries: AccountEntryModel[];

  constructor(props: AccountProps) {
    this.id = props.id;
    this.reservationId = props.reservationId;
    this.status = props.status;
    this.stayBalanceAmount = props.stayBalanceAmount;
    this.stayBalancePaymentMethod = props.stayBalancePaymentMethod;
    this.openedById = props.openedById;
    this.openedByName = props.openedByName;
    this.openedAt = props.openedAt;
    this.closedAt = props.closedAt;
    this.entries = props.entries;
  }

  /**
   * La cuenta se abre al registrar el pago del resto de la estadía. El monto sale de la reserva,
   * nunca del cliente.
   */
  static open(
    reservation: ReservationForAccount,
    paymentMethod: PaymentMethod,
    openedById: string,
    now: Date,
  ): AccountModel {
    return new AccountModel({
      id: v4(),
      reservationId: reservation.id,
      status: AccountStatus.OPEN,
      stayBalanceAmount: stayBalanceOf(reservation),
      stayBalancePaymentMethod: paymentMethod,
      openedById,
      openedByName: null,
      openedAt: now,
      closedAt: null,
      entries: [],
    });
  }

  get isOpen(): boolean {
    return this.status === AccountStatus.OPEN;
  }

  get summary(): AccountSummary {
    return summarizeEntries(this.entries);
  }

  /** Ids de los movimientos que ya tienen su anulación. */
  get reversedEntryIds(): Set<string> {
    return new Set(
      this.entries
        .map((entry) => entry.reversesId)
        .filter((id): id is string => id !== null),
    );
  }

  getNewEntryError(): string | null {
    return this.isOpen
      ? null
      : 'La cuenta está cerrada: no admite movimientos nuevos';
  }

  /**
   * Un pago no puede superar lo que el huésped debe y un reintegro no puede superar su saldo a
   * favor: ninguno de los dos deja la cuenta del otro lado de cero.
   */
  getAmountError(type: DirectEntryType, amount: number): string | null {
    const balanceCents = toCents(this.summary.balance);
    const amountCents = toCents(amount);

    if (type === AccountEntryType.PAYMENT) {
      if (balanceCents <= 0) return 'La cuenta no tiene saldo pendiente';
      if (amountCents > balanceCents) {
        return `El pago supera el saldo pendiente (${formatAmount(balanceCents / 100)})`;
      }
    }
    if (type === AccountEntryType.REFUND) {
      if (balanceCents >= 0) {
        return 'La cuenta no tiene saldo a favor del huésped';
      }
      if (amountCents > -balanceCents) {
        return `El reintegro supera el saldo a favor (${formatAmount(-balanceCents / 100)})`;
      }
    }
    return null;
  }

  getReversalError(entryId: string): string | null {
    const closedError = this.getNewEntryError();
    if (closedError) return closedError;

    const original = this.entries.find((entry) => entry.id === entryId);
    if (!original) return 'El movimiento no pertenece a esta cuenta';
    if (!original.isReversible) {
      return 'Solo se pueden anular cargos y pagos';
    }
    if (this.reversedEntryIds.has(original.id)) {
      return 'El movimiento ya fue anulado';
    }
    return null;
  }

  findEntry(entryId: string): AccountEntryModel | undefined {
    return this.entries.find((entry) => entry.id === entryId);
  }
}

/** Resto de la estadía: total menos la seña ya cobrada. */
export function stayBalanceOf(
  reservation: Pick<ReservationForAccount, 'totalAmount' | 'depositAmount'>,
): number {
  return round2(
    Math.max(
      0,
      Number(reservation.totalAmount) - Number(reservation.depositAmount),
    ),
  );
}

/** Null si a la reserva se le puede abrir la cuenta. */
export function getOpenAccountError(
  reservation: Pick<ReservationForAccount, 'status'>,
): string | null {
  return reservation.status === ReservationStatus.CONFIRMED
    ? null
    : 'Solo se puede abrir la cuenta de una reserva confirmada';
}
