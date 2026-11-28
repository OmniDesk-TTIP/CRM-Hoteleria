import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import {
  AccountEntryModel,
  AccountModel,
  AccountReservationInfo,
} from './account.model';

export const STATEMENT_TITLE = 'Estado de cuenta';
/** US-28: el estado de cuenta no reemplaza a la factura. */
export const STATEMENT_LEGAL_NOTE =
  'Comprobante interno, no válido como factura';

const ORIGIN_LABELS: Record<AccountEntryOrigin, string> = {
  [AccountEntryOrigin.ROOM_SERVICE]: 'Room service',
  [AccountEntryOrigin.SPA]: 'Spa',
  [AccountEntryOrigin.RESTAURANT]: 'Restó',
  [AccountEntryOrigin.BAR]: 'Bar',
  [AccountEntryOrigin.RECEPTION]: 'Recepción',
};

/** +1: sube lo que debe el huésped; −1: lo baja. */
const BALANCE_SIGN: Record<AccountEntryType, 1 | -1> = {
  [AccountEntryType.CHARGE]: 1,
  [AccountEntryType.PAYMENT_REVERSAL]: 1,
  [AccountEntryType.REFUND]: 1,
  [AccountEntryType.PAYMENT]: -1,
  [AccountEntryType.CHARGE_REVERSAL]: -1,
};

export interface StatementRow {
  date: string;
  detail: string;
  origin: string;
  amount: string;
  /** Un movimiento que después se anuló: se muestra atenuado. */
  reversed: boolean;
  /** La anulación de la fila anterior: va debajo de su original. */
  isReversal: boolean;
}

export interface AccountStatement {
  hotelName: string;
  title: string;
  legalNote: string;
  /** Datos del huésped y de la reserva, en el orden en que se muestran. */
  details: { label: string; value: string }[];
  rows: StatementRow[];
  totals: { label: string; value: string; highlight?: boolean }[];
  issuedAt: string;
  filename: string;
}

/** "$ 1.234,50": las fuentes del PDF tienen el espacio duro de es-AR. */
export const formatStatementAmount = (amount: number): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

// guion común y no "−": el signo menos no está en las fuentes estándar del PDF
const signed = (type: AccountEntryType, amount: number): string =>
  `${BALANCE_SIGN[type] > 0 ? '+' : '-'} ${formatStatementAmount(amount)}`;

const formatDateTime = (date: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);

/** YYYY-MM-DD → DD/MM/YYYY sin pasar por Date. */
const formatDay = (isoDay: string): string =>
  isoDay.split('-').reverse().join('/');

function balanceLabel(balance: number): string {
  if (balance > 0) return 'Saldo (debe el huésped)';
  if (balance < 0) return 'Saldo (a favor del huésped)';
  return 'Saldo';
}

/**
 * Filas en orden cronológico. Cada movimiento anulado va seguido de su anulación, así se lee qué
 * se corrigió y por qué, en vez de encontrar la anulación suelta más abajo.
 */
function statementRows(
  entries: AccountEntryModel[],
  timeZone: string,
): StatementRow[] {
  const reversalOf = new Map(
    entries
      .filter((entry) => entry.reversesId !== null)
      .map((entry) => [entry.reversesId, entry]),
  );
  const toRow = (
    entry: AccountEntryModel,
    flags: Pick<StatementRow, 'reversed' | 'isReversal'>,
  ): StatementRow => ({
    date: formatDateTime(entry.registeredAt, timeZone),
    detail: flags.isReversal
      ? `Anulación: ${entry.description}`
      : entry.description,
    origin: ORIGIN_LABELS[entry.origin],
    amount: signed(entry.type, entry.amount),
    ...flags,
  });

  return [...entries]
    .filter((entry) => entry.reversesId === null)
    .sort(
      (a, b) =>
        a.registeredAt.getTime() - b.registeredAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .flatMap((entry) => {
      const reversal = reversalOf.get(entry.id);
      return reversal
        ? [
            toRow(entry, { reversed: true, isReversal: false }),
            toRow(reversal, { reversed: false, isReversal: true }),
          ]
        : [toRow(entry, { reversed: false, isReversal: false })];
    });
}

const slug = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

/** US-28: contenido del estado de cuenta de una reserva. Puro: el renderer lo dibuja. */
export function buildAccountStatement(
  reservation: AccountReservationInfo,
  account: AccountModel,
  hotelName: string,
  now: Date,
  timeZone: string,
): AccountStatement {
  const { totalCharges, totalPayments, balance } = account.summary;
  const checkout = reservation.checkedOutAt
    ? formatDateTime(reservation.checkedOutAt, timeZone)
    : 'Pendiente';

  return {
    hotelName,
    title: STATEMENT_TITLE,
    legalNote: STATEMENT_LEGAL_NOTE,
    details: [
      { label: 'Huésped', value: reservation.guestFullName },
      { label: 'DNI', value: reservation.guestDni },
      {
        label: 'Habitación',
        value: [reservation.roomNumber, reservation.categoryName]
          .filter(Boolean)
          .join(' · '),
      },
      {
        label: 'Estadía',
        value: `${formatDay(reservation.checkIn)} al ${formatDay(reservation.checkOut)}`,
      },
      { label: 'Checkout', value: checkout },
    ],
    rows: statementRows(account.entries, timeZone),
    totals: [
      {
        label: 'Total de cargos',
        value: formatStatementAmount(totalCharges),
      },
      {
        label: 'Total de pagos',
        value: formatStatementAmount(totalPayments),
      },
      {
        label: balanceLabel(balance),
        value: formatStatementAmount(Math.abs(balance)),
        highlight: true,
      },
    ],
    issuedAt: formatDateTime(now, timeZone),
    filename: `estado-de-cuenta-hab-${slug(reservation.roomNumber)}-${reservation.checkIn}.pdf`,
  };
}
