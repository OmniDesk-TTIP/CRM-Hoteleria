import { useEffect, useRef } from 'react';
import MessageBubble from '@/components/admin/chat/MessageBubble';
import ChatComposer from '@/components/admin/chat/ChatComposer';
import HandoverControls from '@/components/admin/chat/HandoverControls';
import { ChatStatusBadge } from '@/components/admin/Badges';
import type { ChatDetail, ChatMessage } from '@/config/types';

interface ChatWindowProps {
  chat: ChatDetail | null;
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isSending: boolean;
  isUpdatingStatus: boolean;
  error: string | null;
  notice: string | null;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onTakeOver: () => Promise<void>;
  onRelease: (closeActiveBooking: boolean) => Promise<void>;
  onDismissNotice: () => void;
  /** Vuelve a la bandeja en pantallas chicas, donde no entran los dos paneles juntos. */
  onBack: () => void;
}

const guestName = (chat: ChatDetail): string =>
  chat.guestDisplayName ?? (chat.telegramUsername ? `@${chat.telegramUsername}` : `Telegram ${chat.telegramUserId}`);

/**
 * Las fechas del proceso de reserva son el texto que el bot le sacó al huésped (un varchar
 * suelto: se ven como "10-02-2027"), no un ISO. Se muestran tal cual en vez de parsearlas:
 * acá solo dan contexto al operador y un `new Date()` sobre ese formato da Invalid Date.
 */
const formatBookingDate = (value: string | null): string => value ?? '—';

/** Conversación abierta: contexto arriba, historial al medio y compositor abajo (CA3). */
export default function ChatWindow({
  chat,
  messages,
  isLoading,
  isLoadingMore,
  isSending,
  isUpdatingStatus,
  error,
  notice,
  hasMore,
  onLoadMore,
  onSend,
  onTakeOver,
  onRelease,
  onDismissNotice,
  onBack,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Si el operador está leyendo hacia arriba, un mensaje nuevo no debe arrastrarlo al final.
  const isNearBottomRef = useRef(true);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;

    isNearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !isNearBottomRef.current) return;

    element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => {
    isNearBottomRef.current = true;

    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat?.id]);

  /** Las páginas viejas se anteponen: hay que compensar el alto nuevo o el scroll salta. */
  const handleLoadMore = async () => {
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;

    isNearBottomRef.current = false;
    await onLoadMore();

    requestAnimationFrame(() => {
      if (!element) return;
      element.scrollTop = previousTop + (element.scrollHeight - previousHeight);
    });
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-goldLight/15 bg-card p-6">
        <p className="text-sm text-dangerText">⚠ {error}</p>
      </div>
    );
  }

  if (isLoading || !chat) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-goldLight/15 bg-card p-6">
        <p className="text-sm text-textMuted">{isLoading ? 'Cargando la conversación…' : 'Elegí una conversación.'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
      <header className="space-y-3 border-b border-goldLight/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="mb-1 text-xs text-textMuted transition hover:text-text motion-reduce:transition-none lg:hidden"
            >
              ← Volver a la bandeja
            </button>
            <h2 className="truncate text-lg font-semibold text-text">{guestName(chat)}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <ChatStatusBadge status={chat.status} />
              {chat.assignedOperator && (
                <span className="text-xs text-textMuted">Atiende {chat.assignedOperator.fullName}</span>
              )}
            </div>
          </div>

          <HandoverControls
            chat={chat}
            isUpdating={isUpdatingStatus}
            onTakeOver={onTakeOver}
            onRelease={onRelease}
          />
        </div>

        {chat.activeBooking && (
          <p className="text-xs text-textMuted">
            Reserva en curso: {formatBookingDate(chat.activeBooking.checkIn)} → {formatBookingDate(chat.activeBooking.checkOut)}
            {chat.activeBooking.capacity ? ` · ${chat.activeBooking.capacity} personas` : ''}
          </p>
        )}

        {notice && (
          <p className="flex items-start justify-between gap-3 rounded-xl bg-danger/15 px-3 py-2 text-xs text-dangerText">
            {notice}
            <button type="button" onClick={onDismissNotice} className="shrink-0 font-medium underline">
              Cerrar
            </button>
          </p>
        )}
      </header>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 space-y-3 overflow-y-auto p-4">
        {hasMore && (
          <div className="text-center">
            <button
              type="button"
              disabled={isLoadingMore}
              onClick={() => void handleLoadMore()}
              className="rounded-full border border-goldLight/20 px-3 py-1.5 text-xs text-textMuted transition hover:bg-goldLight/10 disabled:opacity-40 motion-reduce:transition-none"
            >
              {isLoadingMore ? 'Cargando…' : 'Cargar mensajes anteriores'}
            </button>
          </div>
        )}

        {messages.length === 0 && <p className="text-center text-sm text-textMuted">Todavía no hay mensajes.</p>}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>

      <ChatComposer onSend={onSend} isSending={isSending} status={chat.status} />
    </div>
  );
}
