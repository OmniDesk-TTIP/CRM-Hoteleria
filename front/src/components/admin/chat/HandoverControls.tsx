import { useState } from 'react';
import type { ChatDetail } from '@/config/types';

interface HandoverControlsProps {
  chat: ChatDetail;
  isUpdating: boolean;
  onTakeOver: () => Promise<void>;
  onRelease: (closeActiveBooking: boolean) => Promise<void>;
}

/**
 * El toggle de intervención: "Tomar el control" silencia al bot (CA2) y "Devolver al
 * asistente" lo reactiva avisándole al huésped (CA4). Devolver pide confirmación porque
 * le manda un mensaje al huésped y puede cerrar la reserva que venía armando.
 */
export default function HandoverControls({ chat, isUpdating, onTakeOver, onRelease }: HandoverControlsProps) {
  const [isConfirmingRelease, setIsConfirmingRelease] = useState(false);
  const [closeActiveBooking, setCloseActiveBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      setIsConfirmingRelease(false);
      setCloseActiveBooking(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado de la conversación.');
    }
  };

  if (chat.status !== 'HUMAN') {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => void run(onTakeOver)}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          {isUpdating ? 'Tomando…' : chat.status === 'WAITING_HUMAN' ? 'Atender conversación' : 'Tomar el control'}
        </button>
        {error && <p className="text-xs text-dangerText">⚠ {error}</p>}
      </div>
    );
  }

  if (!isConfirmingRelease) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => setIsConfirmingRelease(true)}
          className="rounded-xl border border-goldLight/30 px-4 py-2 text-sm font-medium text-goldLight transition hover:bg-goldLight/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          Devolver al asistente
        </button>
        {error && <p className="text-xs text-dangerText">⚠ {error}</p>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-2 rounded-2xl border border-goldLight/20 bg-surface p-3 text-sm">
      <p className="text-text">Chamber vuelve a responder y el huésped recibe un aviso por Telegram.</p>

      {chat.activeBooking && (
        <label className="flex items-start gap-2 text-xs text-textMuted">
          <input
            type="checkbox"
            checked={closeActiveBooking}
            onChange={(event) => setCloseActiveBooking(event.target.checked)}
            className="mt-0.5 accent-gold"
          />
          Cerrar también la reserva que venía armando el huésped
        </label>
      )}

      {error && <p className="text-xs text-dangerText">⚠ {error}</p>}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setIsConfirmingRelease(false);
            setError(null);
          }}
          className="rounded-xl px-3 py-1.5 text-sm text-textMuted transition hover:bg-goldLight/10 motion-reduce:transition-none"
        >
          Cancelar
        </button>
        <button
          type="button"
          disabled={isUpdating}
          onClick={() => void run(() => onRelease(closeActiveBooking))}
          className="rounded-xl bg-gold px-3 py-1.5 text-sm font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        >
          {isUpdating ? 'Devolviendo…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
