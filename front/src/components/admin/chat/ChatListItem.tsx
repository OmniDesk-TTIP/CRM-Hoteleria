import type { ChatSummary, HandoverReason } from '@/config/types';

interface ChatListItemProps {
  chat: ChatSummary;
  isActive: boolean;
  onSelect: (chatId: string) => void;
}

const HANDOVER_LABEL: Record<HandoverReason, string> = {
  GUEST_REQUEST: 'Pidió un humano',
  AI_FALLBACK: 'El bot no pudo resolver',
  MANUAL_TAKEOVER: 'Intervención manual',
  OUT_OF_HOURS: 'Pidió un humano fuera de horario',
};

/** "14:32" si fue hoy, "12 mar" si no. La bandeja necesita la fecha corta, no la completa. */
const formatTimestamp = (iso: string | null): string => {
  if (!iso) return '';

  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();

  return isToday
    ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
};

const guestName = (chat: ChatSummary): string =>
  chat.guestDisplayName ?? (chat.telegramUsername ? `@${chat.telegramUsername}` : `Telegram ${chat.telegramUserId}`);

/** Fila de la bandeja: quién es, qué se dijo último y si está esperando a un humano. */
export default function ChatListItem({ chat, isActive, onSelect }: ChatListItemProps) {
  const isPending = chat.handoverRequestedAt !== null;

  return (
    <button
      type="button"
      onClick={() => onSelect(chat.id)}
      aria-current={isActive ? 'true' : undefined}
      className={`w-full border-b border-goldLight/10 px-4 py-3 text-left transition hover:bg-goldLight/5 motion-reduce:transition-none ${
        isActive ? 'bg-goldLight/10' : ''
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-text">{guestName(chat)}</span>
        <span className="shrink-0 text-xs text-textMuted tabular-nums">{formatTimestamp(chat.lastMessageAt)}</span>
      </div>

      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-textMuted">
          {chat.lastMessageRole === 'OPERATOR' && 'Vos: '}
          {chat.lastMessageRole === 'BOT' && 'Chamber: '}
          {chat.lastMessagePreview ?? 'Sin mensajes todavía'}
        </p>

        {chat.unreadCount > 0 && (
          <span
            className="shrink-0 rounded-full bg-gold px-2 py-0.5 text-xs font-semibold text-shell tabular-nums"
            aria-label={`${chat.unreadCount} mensajes sin leer`}
          >
            {chat.unreadCount}
          </span>
        )}
      </div>

      {/* CA1: la derivación la decide el bot en Telegram; acá se ve como un pedido pendiente. */}
      {isPending && (
        <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-xs text-goldLight">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />
          {chat.handoverReason ? HANDOVER_LABEL[chat.handoverReason] : 'Espera un operador'}
        </p>
      )}
    </button>
  );
}
