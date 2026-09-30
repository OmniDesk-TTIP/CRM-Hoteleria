import { useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ChatSessionStatus } from '@/config/types';

/** Mismo tope que el `MaxLength` del `SendChatMessageDto` del back. */
const MAX_LENGTH = 4000;

/**
 * Por qué el compositor está bloqueado: solo se escribe con el control tomado (el back
 * responde 409 si no). En WAITING_HUMAN el bot ya está en pausa desde que el huésped pidió
 * un operador, así que falta únicamente que alguien lo atienda.
 */
const LOCKED_HINT: Partial<Record<ChatSessionStatus, string>> = {
  BOT: 'Chamber está atendiendo esta conversación. Tomá el control para escribirle al huésped.',
  WAITING_HUMAN: 'El huésped pidió hablar con una persona y Chamber ya está en pausa. Atendé la conversación para escribirle.',
};

interface ChatComposerProps {
  /** Rechaza si el envío falló; el texto se conserva para poder reintentar. */
  onSend: (text: string) => Promise<void>;
  isSending: boolean;
  status: ChatSessionStatus;
}

/** Compositor del operador (CA3): lo que se escribe acá llega al Telegram del huésped. */
export default function ChatComposer({ onSend, isSending, status }: ChatComposerProps) {
  const lockedHint = LOCKED_HINT[status];
  const isLocked = lockedHint !== undefined;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();
  const canSend = !isLocked && trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !isSending;

  const submit = async () => {
    if (!canSend) return;

    setError(null);
    try {
      await onSend(trimmed);
      setText('');
    } catch (err) {
      // El interceptor de axios ya dejó el detalle del back en `message` (p. ej. el 502
      // de Telegram). El texto no se borra: el mensaje no se guardó en ningún lado.
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.');
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 border-t border-goldLight/10 p-4">
      {error && <p className="text-sm text-dangerText">⚠ {error}</p>}

      {isLocked && <p className="text-xs text-textMuted">{lockedHint}</p>}

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLocked}
          maxLength={MAX_LENGTH}
          rows={2}
          placeholder="Escribí un mensaje… (Enter envía, Shift+Enter salta de línea)"
          className="flex-1 resize-none rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Mensaje para el huésped"
        />

        <button
          type="submit"
          disabled={!canSend}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          {isSending ? 'Enviando…' : 'Enviar'}
        </button>
      </div>

      <p className="text-right text-[11px] text-textMuted tabular-nums">
        {text.length} / {MAX_LENGTH}
      </p>
    </form>
  );
}
