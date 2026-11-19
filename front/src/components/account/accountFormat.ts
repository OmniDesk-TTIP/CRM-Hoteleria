import type { AccountEntryOrigin, AccountEntryType, AccountStatus, PaymentMethod } from '@/config/types';

/** Montos de la cuenta con centavos: el libro guarda decimal(12,2). */
export const formatPesos = (value: number): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));

export const formatEntryDateTime = (iso: string): string =>
  new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

export const ENTRY_TYPE_LABELS: Record<AccountEntryType, string> = {
  CHARGE: 'Cargo',
  PAYMENT: 'Pago',
  CHARGE_REVERSAL: 'Anulación de cargo',
  PAYMENT_REVERSAL: 'Anulación de pago',
  REFUND: 'Reintegro',
};

export const ENTRY_ORIGIN_LABELS: Record<AccountEntryOrigin, string> = {
  ROOM_SERVICE: 'Room service',
  SPA: 'Spa',
  RESTAURANT: 'Restó',
  RECEPTION: 'Recepción',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  MERCADO_PAGO: 'Mercado Pago',
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
};

/** Cómo mueve el saldo cada tipo: +1 aumenta lo que debe el huésped, −1 lo reduce. */
export const ENTRY_BALANCE_SIGN: Record<AccountEntryType, 1 | -1> = {
  CHARGE: 1,
  PAYMENT_REVERSAL: 1,
  REFUND: 1,
  PAYMENT: -1,
  CHARGE_REVERSAL: -1,
};

export const formatSignedAmount = (type: AccountEntryType, amount: number): string =>
  `${ENTRY_BALANCE_SIGN[type] > 0 ? '+' : '−'} ${formatPesos(amount)}`;
