import { useState, type FormEvent } from 'react';
import type { PaymentMethod, ReservationAccount } from '@/config/types';
import { formatPesos, PAYMENT_METHOD_LABELS } from './accountFormat';

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

interface OpenAccountCardProps {
  reservation: ReservationAccount['reservation'];
  onOpen: (paymentMethod: PaymentMethod) => Promise<void>;
}

/** Sin cuenta abierta: recepción cobra el resto de la estadía y con eso se abre la cuenta. */
export default function OpenAccountCard({ reservation, onOpen }: OpenAccountCardProps) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reservation.status !== 'CONFIRMED') {
    return (
      <div className="rounded-2xl border border-goldLight/15 bg-card p-6 text-sm text-textMuted">
        La cuenta corriente solo se abre en reservas confirmadas.
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const confirmed = window.confirm(
      `¿Registrar el pago de ${formatPesos(reservation.stayBalance)} (${PAYMENT_METHOD_LABELS[paymentMethod]}) y abrir la cuenta?`,
    );
    if (!confirmed) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await onOpen(paymentMethod);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la cuenta.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-goldLight/15 bg-card p-6">
      <div>
        <h2 className="text-lg font-semibold text-text">La cuenta todavía no está abierta</h2>
        <p className="text-sm text-textMuted">
          Se abre al registrar el pago del resto de la estadía. Desde ese momento junta los consumos del huésped.
        </p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-textMuted">Total de la estadía</dt>
          <dd className="text-text">{formatPesos(reservation.totalAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-textMuted">Seña pagada</dt>
          <dd className="text-text">{formatPesos(reservation.depositAmount)}</dd>
        </div>
        <div>
          <dt className="text-xs text-textMuted">Resto a cobrar</dt>
          <dd className="text-lg font-semibold text-goldLight">{formatPesos(reservation.stayBalance)}</dd>
        </div>
      </dl>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Medio de pago
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className="rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {PAYMENT_METHOD_LABELS[method]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        >
          {isSubmitting ? 'Registrando…' : 'Registrar pago y abrir cuenta'}
        </button>
      </div>
    </form>
  );
}
