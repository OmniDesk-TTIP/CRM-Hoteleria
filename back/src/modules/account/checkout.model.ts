import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { RoomServiceOrderStatus } from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import { SpaReservationStatus } from '../../infrastructure/database/entities/SpaReservation.entity';
import { ORDER_STATUS_LABELS } from '../roomService/roomService.model';
import { AccountModel } from './account.model';

/** Un consumo que todavía no terminó: un pedido de room service o un turno de spa por venir. */
export interface ActiveService {
  kind: 'ROOM_SERVICE' | 'SPA';
  id: string;
  description: string;
}

/** "Room service: 2 x Café (en preparación)" */
export function describeActiveOrder(order: {
  status: RoomServiceOrderStatus;
  items: { name: string; quantity: number }[];
}): string {
  const items = order.items
    .map((item) => `${item.quantity} x ${item.name}`)
    .join(', ');
  return `Room service: ${items} (${ORDER_STATUS_LABELS[order.status].toLowerCase()})`;
}

/** "Spa: Masaje el 16/03/2099 a las 15:00 (pendiente de confirmar)" */
export function describeSpaTurn(turn: {
  status: SpaReservationStatus;
  serviceName: string;
  /** YYYY-MM-DD */
  requestedDate: string;
  requestedTime: string;
}): string {
  const day = turn.requestedDate.split('-').reverse().join('/');
  const pending =
    turn.status === SpaReservationStatus.PENDING
      ? ' (pendiente de confirmar)'
      : '';
  return `Spa: ${turn.serviceName} el ${day} a las ${turn.requestedTime}${pending}`;
}

/** Lo que hace falta saber, con la reserva y la cuenta bloqueadas, para decidir el checkout. */
export interface CheckoutState {
  reservationStatus: ReservationStatus;
  checkedOutAt: Date | null;
  account: AccountModel | null;
  activeServices: ActiveService[];
}

export enum CheckoutBlockCode {
  NOT_CONFIRMED = 'CHECKOUT_NOT_CONFIRMED',
  ALREADY_CHECKED_OUT = 'CHECKOUT_ALREADY_DONE',
  NO_ACCOUNT = 'CHECKOUT_NO_ACCOUNT',
  PENDING_BALANCE = 'CHECKOUT_PENDING_BALANCE',
  ACTIVE_SERVICES = 'CHECKOUT_ACTIVE_SERVICES',
}

/** Por qué no se puede hacer el checkout. El panel usa `code` para saber qué mostrar. */
export type CheckoutBlock =
  | {
      code:
        | CheckoutBlockCode.NOT_CONFIRMED
        | CheckoutBlockCode.ALREADY_CHECKED_OUT
        | CheckoutBlockCode.NO_ACCOUNT;
      message: string;
    }
  | {
      code: CheckoutBlockCode.PENDING_BALANCE;
      message: string;
      /** Positivo: lo que debe el huésped; negativo: su saldo a favor. */
      balance: number;
    }
  | {
      code: CheckoutBlockCode.ACTIVE_SERVICES;
      message: string;
      activeServices: ActiveService[];
    };

const formatAmount = (amount: number): string =>
  `$${amount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * US-30: el checkout solo se hace con la cuenta en $0. Los consumos en curso no lo frenan del
 * todo: se avisan y recepción decide (`force`), porque un pedido que se cancele después del
 * checkout ya no puede anular su cargo en una cuenta cerrada.
 */
export function getCheckoutBlock(
  state: CheckoutState,
  force: boolean,
): CheckoutBlock | null {
  if (state.reservationStatus !== ReservationStatus.CONFIRMED) {
    return {
      code: CheckoutBlockCode.NOT_CONFIRMED,
      message: 'Solo se puede hacer el checkout de una reserva confirmada',
    };
  }
  if (state.checkedOutAt || (state.account && !state.account.isOpen)) {
    return {
      code: CheckoutBlockCode.ALREADY_CHECKED_OUT,
      message: 'La estadía ya tiene el checkout hecho',
    };
  }
  if (!state.account) {
    return {
      code: CheckoutBlockCode.NO_ACCOUNT,
      message:
        'La reserva no tiene la cuenta abierta: registrá primero el pago del resto de la estadía',
    };
  }

  const { balance } = state.account.summary;
  if (balance !== 0) {
    return {
      code: CheckoutBlockCode.PENDING_BALANCE,
      message:
        balance > 0
          ? `El huésped tiene un saldo pendiente de ${formatAmount(balance)}`
          : `El huésped tiene un saldo a favor de ${formatAmount(-balance)}: hacé el reintegro antes del checkout`,
      balance,
    };
  }

  if (!force && state.activeServices.length > 0) {
    return {
      code: CheckoutBlockCode.ACTIVE_SERVICES,
      message:
        'Hay consumos en curso. Si hacés el checkout igual, ya no se van a poder cargar ni anular en la cuenta.',
      activeServices: state.activeServices,
    };
  }
  return null;
}
