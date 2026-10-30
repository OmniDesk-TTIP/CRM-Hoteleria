import { v4 } from 'uuid';
import {
  RoomServiceOrderItem,
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { groupMenu, MenuItemModel } from '../restaurant/model/restaurant.model';
import { toMinutes } from '../supportHours/supportHours.util';
import { escapeHtml } from '../telegram/telegram.format';

export const MAX_ORDER_LINES = 20;
export const MAX_QUANTITY_PER_ITEM = 20;

export const DRAFT_TTL_MINUTES = 60;

export const ORDER_STATUS_LABELS: Record<RoomServiceOrderStatus, string> = {
  [RoomServiceOrderStatus.PENDING_CONFIRMATION]: 'Sin confirmar',
  [RoomServiceOrderStatus.RECEIVED]: 'Recibido',
  [RoomServiceOrderStatus.IN_PREPARATION]: 'En preparación',
  [RoomServiceOrderStatus.DELIVERED]: 'Entregado',
  [RoomServiceOrderStatus.CANCELLED]: 'Cancelado',
};

export const OPEN_STATUSES = [
  RoomServiceOrderStatus.RECEIVED,
  RoomServiceOrderStatus.IN_PREPARATION,
];

const ALLOWED_TRANSITIONS: Record<
  RoomServiceOrderStatus,
  RoomServiceOrderStatus[]
> = {
  [RoomServiceOrderStatus.PENDING_CONFIRMATION]: [],
  [RoomServiceOrderStatus.RECEIVED]: [
    RoomServiceOrderStatus.IN_PREPARATION,
    RoomServiceOrderStatus.CANCELLED,
  ],
  [RoomServiceOrderStatus.IN_PREPARATION]: [
    RoomServiceOrderStatus.DELIVERED,
    RoomServiceOrderStatus.CANCELLED,
  ],
  [RoomServiceOrderStatus.DELIVERED]: [],
  [RoomServiceOrderStatus.CANCELLED]: [],
};

export interface CurrentStay {
  reservationId: string;
  guestFullName: string;
  guestDni: string;
  roomNumber: string;
}

interface StayCandidate {
  status: ReservationStatus;
  checkIn: string;
  checkOut: string;
}

export function findCurrentStay<T extends StayCandidate>(
  reservations: T[],
  today: string,
): T | null {
  const current = reservations
    .filter(
      (reservation) =>
        reservation.status === ReservationStatus.CONFIRMED &&
        reservation.checkIn <= today &&
        reservation.checkOut >= today,
    )
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut));
  return current[0] ?? null;
}

export interface RoomServiceHours {
  enabled: boolean;
  opensAt: string;
  closesAt: string;
}

export function isRoomServiceOpen(
  hours: RoomServiceHours,
  nowMinutes: number,
): boolean {
  if (!hours.enabled) return false;

  const opens = toMinutes(hours.opensAt);
  const closes = toMinutes(hours.closesAt);
  return opens < closes
    ? nowMinutes >= opens && nowMinutes < closes
    : nowMinutes >= opens || nowMinutes < closes;
}

export function describeRoomServiceHours(hours: RoomServiceHours): string {
  return `todos los días de ${hours.opensAt} a ${hours.closesAt}`;
}

export interface RoomServiceOrderProps {
  id: string;
  status: RoomServiceOrderStatus;
  paymentStatus: RoomServicePaymentStatus;
  telegramUserId: string;
  roomReservationId: string;
  roomNumber: string;
  guestFullName: string;
  items: RoomServiceOrderItem[];
  notes: string | null;
  total: number;
  confirmedAt: Date | null;
  mpInitPoint: string | null;
  createdAt?: Date;
}

export interface OrderLine {
  menuItem: MenuItemModel;
  quantity: number;
  notes: string | null;
}

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

export class RoomServiceOrderModel {
  readonly id: string;
  status: RoomServiceOrderStatus;
  paymentStatus: RoomServicePaymentStatus;
  readonly telegramUserId: string;
  readonly roomReservationId: string;
  readonly roomNumber: string;
  readonly guestFullName: string;
  readonly items: RoomServiceOrderItem[];
  readonly notes: string | null;
  readonly total: number;
  confirmedAt: Date | null;
  mpInitPoint: string | null;
  readonly createdAt?: Date;

  constructor(props: RoomServiceOrderProps) {
    this.id = props.id;
    this.status = props.status;
    this.paymentStatus = props.paymentStatus;
    this.telegramUserId = props.telegramUserId;
    this.roomReservationId = props.roomReservationId;
    this.roomNumber = props.roomNumber;
    this.guestFullName = props.guestFullName;
    this.items = props.items.map((item) => ({ ...item }));
    this.notes = props.notes;
    this.total = props.total;
    this.confirmedAt = props.confirmedAt;
    this.mpInitPoint = props.mpInitPoint;
    this.createdAt = props.createdAt;
  }

  static createDraft(input: {
    telegramUserId: string;
    stay: CurrentStay;
    lines: OrderLine[];
    notes: string | null;
    now?: Date;
  }): RoomServiceOrderModel {
    const items: RoomServiceOrderItem[] = [];
    for (const line of input.lines) {
      const existing = items.find(
        (item) => item.menuItemId === line.menuItem.id,
      );
      if (existing) {
        existing.quantity += line.quantity;
        existing.notes =
          [existing.notes, line.notes].filter(Boolean).join('; ') || null;
        continue;
      }
      items.push({
        menuItemId: line.menuItem.id,
        name: line.menuItem.name,
        unitPrice: line.menuItem.price,
        quantity: line.quantity,
        notes: line.notes,
      });
    }

    return new RoomServiceOrderModel({
      id: v4(),
      status: RoomServiceOrderStatus.PENDING_CONFIRMATION,
      paymentStatus: RoomServicePaymentStatus.PENDING,
      telegramUserId: input.telegramUserId,
      roomReservationId: input.stay.reservationId,
      roomNumber: input.stay.roomNumber,
      guestFullName: input.stay.guestFullName,
      items,
      notes: input.notes,
      total: roundMoney(
        items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      ),
      confirmedAt: null,
      mpInitPoint: null,
      createdAt: input.now,
    });
  }

  static getLinesError(lines: OrderLine[]): string | null {
    if (lines.length === 0) return 'Decime qué querés pedir.';
    if (lines.length > MAX_ORDER_LINES) {
      return `Por el chat puedo tomar hasta ${MAX_ORDER_LINES} platos distintos por pedido.`;
    }
    const total = new Map<string, number>();
    for (const line of lines) {
      total.set(
        line.menuItem.id,
        (total.get(line.menuItem.id) ?? 0) + line.quantity,
      );
    }
    if ([...total.values()].some((qty) => qty > MAX_QUANTITY_PER_ITEM)) {
      return `Puedo tomar hasta ${MAX_QUANTITY_PER_ITEM} unidades de cada plato.`;
    }
    return null;
  }

  isDraft(): boolean {
    return this.status === RoomServiceOrderStatus.PENDING_CONFIRMATION;
  }

  isDraftExpired(now: Date): boolean {
    if (!this.createdAt) return false;
    return (
      now.getTime() - this.createdAt.getTime() > DRAFT_TTL_MINUTES * 60 * 1000
    );
  }

  confirm(now: Date): string | null {
    if (!this.isDraft()) return 'Ese pedido ya fue confirmado.';
    this.status = RoomServiceOrderStatus.RECEIVED;
    this.confirmedAt = now;
    return null;
  }

  canTransitionTo(next: RoomServiceOrderStatus): boolean {
    return ALLOWED_TRANSITIONS[this.status].includes(next);
  }

  changeStatus(next: RoomServiceOrderStatus): string | null {
    if (!this.canTransitionTo(next)) {
      return `No se puede pasar un pedido de ${ORDER_STATUS_LABELS[this.status]} a ${ORDER_STATUS_LABELS[next]}`;
    }
    this.status = next;
    return null;
  }

  getGuestCancelError(): string | null {
    if (this.status === RoomServiceOrderStatus.RECEIVED) return null;
    if (this.status === RoomServiceOrderStatus.IN_PREPARATION) {
      return 'Tu pedido ya está en preparación, así que no lo puedo cancelar. Si necesitás algo, te paso con recepción.';
    }
    return `Ese pedido ya está ${ORDER_STATUS_LABELS[this.status].toLowerCase()}.`;
  }

  cancelByGuest(): string | null {
    const error = this.getGuestCancelError();
    if (error) return error;
    this.status = RoomServiceOrderStatus.CANCELLED;
    return null;
  }

  confirmPayment(): string | null {
    if (this.isDraft()) return 'El pedido todavía no fue confirmado';
    if (this.paymentStatus === RoomServicePaymentStatus.PAID) {
      return 'El pedido ya estaba pagado';
    }
    this.paymentStatus = RoomServicePaymentStatus.PAID;
    return null;
  }

  getSummary(): string {
    const lines = this.items.map((item) => {
      const notes = item.notes ? ` (${escapeHtml(item.notes)})` : '';
      return `• ${item.quantity} x ${escapeHtml(item.name)}${notes} — $${roundMoney(item.unitPrice * item.quantity)}`;
    });
    return [
      `🛎️ <b>Tu pedido de room service</b> para la habitación <b>${escapeHtml(this.roomNumber)}</b>:`,
      '',
      ...lines,
      ...(this.notes ? ['', `Aclaraciones: ${escapeHtml(this.notes)}`] : []),
      '',
      `<b>Total: $${this.total}</b>`,
    ].join('\n');
  }

  describeItems(): string {
    return this.items
      .map((item) => `${item.quantity} x ${item.name}`)
      .join(', ');
  }

  getStatusNotice(): string | null {
    if (this.status === RoomServiceOrderStatus.IN_PREPARATION) {
      return `👨‍🍳 Tu pedido de room service (${this.describeItems()}) ya está en preparación.`;
    }
    if (this.status === RoomServiceOrderStatus.DELIVERED) {
      return `✅ Tu pedido de room service fue entregado en la habitación ${this.roomNumber}. ¡Que lo disfrutes!`;
    }
    if (this.status === RoomServiceOrderStatus.CANCELLED) {
      const refund =
        this.paymentStatus === RoomServicePaymentStatus.PAID
          ? ' Como ya lo habías pagado, recepción se va a comunicar para la devolución.'
          : '';
      return `Tu pedido de room service (${this.describeItems()}) fue cancelado.${refund}`;
    }
    return null;
  }

  getPaymentNotice(): string {
    return `💳 ¡Recibimos el pago de tu pedido de room service ($${this.total})! Gracias.`;
  }
}

export const MAX_ROOM_SERVICE_ITEMS_IN_BLOCK = 60;

export interface RoomServiceBlockInput {
  hours: RoomServiceHours | null;
  isOpenNow: boolean;
  stay: CurrentStay | null;
  menu: MenuItemModel[];
  menuUrl: string | null;
  openOrder: RoomServiceOrderModel | null;
}

export function buildRoomServiceBlock({
  hours,
  isOpenNow,
  stay,
  menu,
  menuUrl,
  openOrder,
}: RoomServiceBlockInput): string {
  const lines = ['[ROOM SERVICE]'];

  if (!hours || !hours.enabled) {
    lines.push('El room service no está disponible por el momento.');
    return lines.join('\n');
  }

  if (!stay) {
    lines.push(
      'CLIENTE: NO es huésped alojado hoy (no tiene reserva, la tiene a futuro o su estadía ya terminó). El room service es solo para huéspedes alojados: no se lo ofrezcas, no le compartas la carta de room service ni le tomes pedidos.',
    );
    return lines.join('\n');
  }

  lines.push(
    `CLIENTE: HUÉSPED ALOJADO en la habitación ${stay.roomNumber} (puede pedir room service).`,
    `HORARIO: ${describeRoomServiceHours(hours)}.`,
    isOpenNow
      ? 'ESTADO: ABIERTO, se pueden tomar pedidos ahora.'
      : 'ESTADO: CERRADO en este momento. No tomes pedidos: informale el horario.',
    menuUrl
      ? `CARTA EN LA WEB: ${menuUrl}`
      : 'CARTA EN LA WEB: no hay link publicado.',
  );

  if (openOrder) {
    lines.push(
      `PEDIDO EN CURSO: ${openOrder.describeItems()} | total $${openOrder.total} | estado ${ORDER_STATUS_LABELS[openOrder.status]}.`,
    );
  }

  lines.push('CARTA DE ROOM SERVICE:');
  if (menu.length === 0) {
    lines.push('- No hay platos disponibles para room service por el momento.');
  }
  for (const section of groupMenu(
    menu.slice(0, MAX_ROOM_SERVICE_ITEMS_IN_BLOCK),
  )) {
    lines.push(`${section.category}:`);
    for (const item of section.items) {
      lines.push(`- id=${item.id} | ${item.name} | $${item.price}`);
    }
  }
  return lines.join('\n');
}
