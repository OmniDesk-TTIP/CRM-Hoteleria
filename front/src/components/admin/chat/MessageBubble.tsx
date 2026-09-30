import type { ChatMessage } from '@/config/types';

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

/**
 * Un mensaje del historial. El huésped va a la izquierda; el bot y el operador, a la
 * derecha (el hotel es un solo interlocutor visto desde Telegram). Los avisos
 * automáticos de transición van centrados, porque no los escribió nadie.
 */
export default function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'SYSTEM') {
    return (
      <p className="mx-auto max-w-md text-center text-xs text-textMuted">
        {message.content}
        <span className="ml-2 tabular-nums opacity-70">{formatTime(message.createdAt)}</span>
      </p>
    );
  }

  const isGuest = message.role === 'USER';
  const isOperator = message.role === 'OPERATOR';

  return (
    <div className={`flex ${isGuest ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 sm:max-w-[70%] ${
          isGuest
            ? 'bg-surface text-text'
            : isOperator
              ? 'bg-gold/20 text-text'
              : 'border border-goldLight/15 bg-transparent text-textMuted'
        }`}
      >
        <p className="text-xs font-medium text-goldLight">
          {isGuest ? 'Huésped' : isOperator ? (message.sentBy?.fullName ?? 'Operador') : 'Chamber'}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{message.content}</p>
        <p className="mt-1 text-right text-[11px] text-textMuted tabular-nums">{formatTime(message.createdAt)}</p>
      </div>
    </div>
  );
}
