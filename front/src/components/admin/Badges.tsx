import type {
  AdminReservation,
  ChatSessionStatus,
  ReservationOrigin,
  ReservationStatus,
  RestaurantReservationStatus,
  RoomStatus,
  SpaReservationStatus,
  SpaServiceStatus,
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

export function CancellationNote({ reservation }: { reservation: AdminReservation }) {
  if (reservation.status !== 'CANCELLED' || reservation.refundAmount === null) return null;

  const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
  const amount = Number(reservation.refundAmount);
  const detail = reservation.cancellationPolicyName
    ? `${reservation.refundPercentage ?? 0}% · ${reservation.cancellationPolicyName}`
    : 'Sin política vigente';

  return (
    <p className="mt-1 text-xs text-textMuted">
      {amount > 0 ? (
        <>
          Devolución {money.format(amount)}{' '}
          <span className={reservation.refundStatus === 'COMPLETED' ? 'text-successText' : 'text-goldLight'}>
            ({reservation.refundStatus === 'COMPLETED' ? 'realizada' : 'pendiente'})
          </span>
        </>
      ) : (
        'Sin devolución'
      )}
      <span className="block">{detail}</span>
    </p>
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

const SPA_STATUS_LABEL: Record<SpaServiceStatus, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Deshabilitado',
};

const SPA_STATUS_CLASSES: Record<SpaServiceStatus, string> = {
  ACTIVE: 'bg-success/20 text-successText',
  INACTIVE: 'bg-danger/15 text-dangerText',
};

export function SpaStatusBadge({ status }: { status: SpaServiceStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${SPA_STATUS_CLASSES[status]}`}
    >
      {SPA_STATUS_LABEL[status]}
    </span>
  );
}

const REQUEST_STATUS_LABEL: Record<SpaReservationStatus, string> = {
  PENDING: 'Pendiente',
  PENDING_PAYMENT: 'Esperando pago',
  CONFIRMED: 'Confirmada',
  REJECTED: 'Rechazada',
  CANCELLED: 'Vencida (sin pago)',
};

const REQUEST_STATUS_CLASSES: Record<SpaReservationStatus, string> = {
  PENDING: 'bg-gold/15 text-goldLight',
  PENDING_PAYMENT: 'bg-gold/15 text-goldLight',
  CONFIRMED: 'bg-success/20 text-successText',
  REJECTED: 'bg-danger/15 text-dangerText',
  CANCELLED: 'bg-surface text-textMuted',
};

export function SpaReservationStatusBadge({ status }: { status: SpaReservationStatus }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${REQUEST_STATUS_CLASSES[status]}`}
    >
      {REQUEST_STATUS_LABEL[status]}
    </span>
  );
}

/** Los pedidos de mesa solo los resuelve recepción: no hay estados de pago. */
export function RestaurantReservationStatusBadge({ status }: { status: RestaurantReservationStatus }) {
  return <SpaReservationStatusBadge status={status} />;
}
type ReviewPublicationState = 'PUBLISHED' | 'CAN_PUBLISH' | 'NO_CONSENT';

const REVIEW_PUBLICATION_LABEL: Record<ReviewPublicationState, string> = {
  PUBLISHED: 'Publicada en la web',
  CAN_PUBLISH: 'Autorizada para publicar',
  NO_CONSENT: 'Sin autorización para publicar',
};

const REVIEW_PUBLICATION_CLASSES: Record<ReviewPublicationState, string> = {
  PUBLISHED: 'bg-success/20 text-successText',
  CAN_PUBLISH: 'bg-gold/15 text-goldLight',
  NO_CONSENT: 'bg-surface text-textMuted',
};

/** Si la reseña se ve en la web del hotel, o si el huésped autorizó mostrarla (US-18). */
export function ReviewPublicationBadge({ published, publishConsent }: { published: boolean; publishConsent: boolean }) {
  const state: ReviewPublicationState = published ? 'PUBLISHED' : publishConsent ? 'CAN_PUBLISH' : 'NO_CONSENT';

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${REVIEW_PUBLICATION_CLASSES[state]}`}
    >
      {REVIEW_PUBLICATION_LABEL[state]}
    </span>
  );
}
