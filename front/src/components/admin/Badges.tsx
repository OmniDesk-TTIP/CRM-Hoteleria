import type {
  ChatSessionStatus,
  ReservationOrigin,
  ReservationStatus,
  RoomStatus,
} from '@/config/types';

const STATUS_LABEL: Record<ReservationStatus, string> = {
  PENDING_PAYMENT: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
};

const STATUS_CLASSES: Record<ReservationStatus, string> = {
  PENDING_PAYMENT: 'bg-gold/15 text-goldLight',
  CONFIRMED: 'bg-success/20 text-successText',
  CANCELLED: 'bg-danger/15 text-dangerText',
};

export function StatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const ORIGIN_LABEL: Record<ReservationOrigin, string> = {
  BOT: 'Chamber (Bot)',
  MANUAL: 'Manual',
};

export function OriginBadge({ origin }: { origin: ReservationOrigin }) {
  const isBot = origin === 'BOT';

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
        isBot
          ? 'border-goldLight/20 bg-surface text-textMuted'
          : 'border-goldLight/30 bg-transparent text-goldLight'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isBot ? 'bg-textMuted' : 'bg-gold'}`}
        aria-hidden
      />
      {ORIGIN_LABEL[origin]}
    </span>
  );
}

const CHAT_STATUS_LABEL: Record<ChatSessionStatus, string> = {
  BOT: 'Chamber',
  WAITING_HUMAN: 'Esperando operador',
  HUMAN: 'Atendido por un humano',
};

const CHAT_STATUS_CLASSES: Record<ChatSessionStatus, string> = {
  BOT: 'bg-surface text-textMuted',
  WAITING_HUMAN: 'bg-gold/15 text-goldLight',
  HUMAN: 'bg-success/20 text-successText',
};

/** Quién está atendiendo la conversación: el bot, nadie todavía, o un operador (US-11). */
export function ChatStatusBadge({ status }: { status: ChatSessionStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${CHAT_STATUS_CLASSES[status]}`}
    >
      {CHAT_STATUS_LABEL[status]}
    </span>
  );
}

const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  ACTIVE: 'Activa',
  MAINTENANCE: 'Mantenimiento',
  INACTIVE: 'Deshabilitada',
};

const ROOM_STATUS_CLASSES: Record<RoomStatus, string> = {
  ACTIVE: 'bg-success/20 text-successText',
  MAINTENANCE: 'bg-gold/15 text-goldLight',
  INACTIVE: 'bg-danger/15 text-dangerText',
};

export function RoomStatusBadge({ status }: { status: RoomStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${ROOM_STATUS_CLASSES[status]}`}
    >
      {ROOM_STATUS_LABEL[status]}
    </span>
  );
}
