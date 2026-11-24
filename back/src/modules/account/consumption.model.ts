import { v5 } from 'uuid';
import { PaymentMethod } from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import {
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import {
  AccountEntryModel,
  AccountModel,
  EntryAuthor,
  MAX_ENTRY_DESCRIPTION_LENGTH,
} from './account.model';

/** Los movimientos automáticos los registra Chamber. */
const CHAMBER: EntryAuthor = { userId: null };

/** Namespace fijo para derivar las claves de operación de los movimientos automáticos. */
const CONSUMPTION_NAMESPACE = '0b3c8f9e-6a1d-4c2e-9f57-2d8e4a1b7c63';

export const CANCELLED_CONSUMPTION_REASON = 'Pedido cancelado';
export const LINK_PAYMENT_DESCRIPTION = 'Pago con link de Mercado Pago';

/**
 * Foto de un consumo (por ahora, un pedido de room service) tal como tiene que verse en la
 * cuenta. La cuenta se pone al día con la foto, así que mandar la misma foto dos veces no hace
 * nada: un evento repetido o un cambio de estado de más nunca generan otro cargo.
 */
export interface Consumption {
  origin: AccountEntryOrigin;
  sourceId: string;
  description: string;
  amount: number;
  /** false si se canceló o se rechazó: el cargo se anula. */
  active: boolean;
  /** Pago con link ya acreditado; `reference` es el id del pago en Mercado Pago. */
  payment: { reference: string } | null;
}

/** Lo que hace falta de un pedido de room service para reflejarlo en la cuenta. */
export interface RoomServiceOrderSnapshot {
  id: string;
  status: RoomServiceOrderStatus;
  paymentStatus: RoomServicePaymentStatus;
  items: { name: string; quantity: number }[];
  total: number;
  mpPaymentId: string | null;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Null para un borrador: el huésped todavía no confirmó, no es un consumo. */
export function roomServiceConsumption(
  order: RoomServiceOrderSnapshot,
): Consumption | null {
  if (order.status === RoomServiceOrderStatus.PENDING_CONFIRMATION) {
    return null;
  }
  const items = order.items
    .map((item) => `${item.quantity} x ${item.name}`)
    .join(', ');
  const paid =
    order.paymentStatus === RoomServicePaymentStatus.PAID &&
    order.mpPaymentId !== null;

  return {
    origin: AccountEntryOrigin.ROOM_SERVICE,
    sourceId: order.id,
    description: truncate(
      `Room service: ${items}`,
      MAX_ENTRY_DESCRIPTION_LENGTH,
    ),
    amount: Number(order.total),
    active: order.status !== RoomServiceOrderStatus.CANCELLED,
    payment: paid ? { reference: order.mpPaymentId! } : null,
  };
}

/** Clave estable por consumo y tipo: la FK única de `operation_id` frena un duplicado en la base. */
export const consumptionOperationId = (
  consumption: Pick<Consumption, 'origin' | 'sourceId'>,
  type: AccountEntryType.CHARGE | AccountEntryType.PAYMENT,
): string =>
  v5(
    `${consumption.origin}:${type}:${consumption.sourceId}`,
    CONSUMPTION_NAMESPACE,
  );

/**
 * Movimientos que le faltan a la cuenta para reflejar el consumo:
 * - activo y sin cargo → el cargo;
 * - cancelado con cargo sin anular → la anulación;
 * - pagado con link y sin pago registrado → el pago, solo si el consumo llegó a tener cargo (un
 *   pedido que ya estaba cancelado antes de abrir la cuenta no entra).
 * Una cuenta cerrada no recibe nada. Pura: decide con la cuenta bloqueada que le pasa el repository.
 */
export function planConsumptionEntries(
  account: AccountModel,
  consumption: Consumption,
  now: Date,
): AccountEntryModel[] {
  if (!account.isOpen || consumption.amount <= 0) return [];

  const ofSource = (type: AccountEntryType) =>
    account.entries.find(
      (entry) =>
        entry.type === type &&
        entry.origin === consumption.origin &&
        entry.sourceId === consumption.sourceId,
    );

  const planned: AccountEntryModel[] = [];

  let charge = ofSource(AccountEntryType.CHARGE);
  if (!charge && consumption.active) {
    charge = AccountEntryModel.create(
      account.id,
      {
        type: AccountEntryType.CHARGE,
        amount: consumption.amount,
        description: consumption.description,
        origin: consumption.origin,
        sourceId: consumption.sourceId,
        operationId: consumptionOperationId(
          consumption,
          AccountEntryType.CHARGE,
        ),
      },
      CHAMBER,
      now,
    );
    planned.push(charge);
  }
  if (!charge) return planned;

  if (!consumption.active && !account.reversedEntryIds.has(charge.id)) {
    planned.push(
      AccountEntryModel.reversalOf(
        charge,
        CANCELLED_CONSUMPTION_REASON,
        CHAMBER,
        now,
      ),
    );
  }

  if (consumption.payment && !ofSource(AccountEntryType.PAYMENT)) {
    // sin tope de saldo: la plata ya entró por Mercado Pago, la cuenta tiene que mostrarla
    planned.push(
      AccountEntryModel.create(
        account.id,
        {
          type: AccountEntryType.PAYMENT,
          amount: consumption.amount,
          description: LINK_PAYMENT_DESCRIPTION,
          origin: consumption.origin,
          sourceId: consumption.sourceId,
          paymentMethod: PaymentMethod.MERCADO_PAGO,
          reference: consumption.payment.reference,
          operationId: consumptionOperationId(
            consumption,
            AccountEntryType.PAYMENT,
          ),
        },
        CHAMBER,
        now,
      ),
    );
  }

  return planned;
}

/**
 * Varios consumos de una vez (al abrir la cuenta). Cada uno decide con la cuenta más lo que ya
 * planearon los anteriores, así dos fotos del mismo pedido no se duplican.
 */
export function planConsumptionsEntries(
  account: AccountModel,
  consumptions: Consumption[],
  now: Date,
): AccountEntryModel[] {
  return consumptions.reduce<AccountEntryModel[]>((planned, consumption) => {
    const current = new AccountModel({
      ...account,
      entries: [...account.entries, ...planned],
    });
    return [...planned, ...planConsumptionEntries(current, consumption, now)];
  }, []);
}
