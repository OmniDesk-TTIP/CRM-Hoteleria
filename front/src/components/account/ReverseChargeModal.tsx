import { useState, type FormEvent } from 'react';
import type { AccountEntry } from '@/config/types';
import { formatPesos } from './accountFormat';

/** Mismo tope que la descripción de un movimiento en el back: el motivo queda como descripción. */
const MAX_REASON_LENGTH = 200;

interface ReverseChargeModalProps {
  entry: AccountEntry;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}

/** US-27: un administrador anula un consumo cargado por error, con motivo obligatorio. */
export default function ReverseChargeModal({ entry, onClose, onSubmit }: ReverseChargeModalProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) {
      setError('El motivo es obligatorio.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(reason.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo anular el cargo.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reverse-charge-title"
        className="w-full max-w-md space-y-4 rounded-2xl border border-danger/20 bg-card p-5 shadow-xl sm:p-6"
      >
        <div>
          <h2 id="reverse-charge-title" className="text-lg font-bold text-text">
            Anular cargo
          </h2>
          <p className="text-sm text-textMuted">
            {entry.description} · <strong className="text-text">{formatPesos(entry.amount)}</strong>
          </p>
          <p className="mt-1 text-xs text-textMuted">
            Se registra una anulación por el mismo monto; el cargo original queda en el historial.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Motivo
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            required
            autoFocus
            placeholder="Se cargó a la habitación equivocada"
            className="w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          />
        </label>

        {error && (
          <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text disabled:opacity-50"
          >
            Atrás
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-danger/90 px-4 py-2 font-medium text-white transition hover:bg-danger disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Anulando…' : 'Anular cargo'}
          </button>
        </div>
      </form>
    </div>
  );
}
