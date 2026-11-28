import { useState, type FormEvent } from 'react';
import type { AccountPaymentData, PaymentMethod } from '@/config/types';
import { formatPesos, PAYMENT_METHOD_LABELS } from './accountFormat';

/** Mismo tope que la referencia de un movimiento en el back. */
const MAX_REFERENCE_LENGTH = 100;

/** Recepción cobra con el posnet: la tarjeta se nombra así para que no haya dudas. */
const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CARD', label: 'Tarjeta (posnet)' },
  { value: 'CASH', label: PAYMENT_METHOD_LABELS.CASH },
  { value: 'TRANSFER', label: PAYMENT_METHOD_LABELS.TRANSFER },
  { value: 'MERCADO_PAGO', label: PAYMENT_METHOD_LABELS.MERCADO_PAGO },
];

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

interface CollectPaymentModalProps {
  /** Lo que debe el huésped: es el monto sugerido y el máximo. */
  balance: number;
  onClose: () => void;
  onSubmit: (payment: AccountPaymentData) => Promise<void>;
}

/**
 * Cobro del saldo pendiente en recepción (US-27). El cobro en sí lo hace el posnet del hotel;
 * acá se registra en la cuenta. Se puede cobrar menos que el saldo (pago parcial).
 */
export default function CollectPaymentModal({ balance, onClose, onSubmit }: CollectPaymentModalProps) {
  // una clave por formulario: si el envío se reintenta, el back no registra el pago dos veces
  const [operationId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CARD');
  const [reference, setReference] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(amount.replace(',', '.'));
  const isValid = Number.isFinite(parsed) && parsed > 0 && Number(parsed.toFixed(2)) === parsed;
  const exceeds = isValid && parsed > balance;
  const remaining = isValid && !exceeds ? balance - parsed : null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid) {
      setError('Ingresá un monto mayor a cero, con hasta dos decimales.');
      return;
    }
    if (exceeds) {
      setError(`El pago no puede superar el saldo pendiente (${formatPesos(balance)}).`);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        operationId,
        amount: parsed,
        paymentMethod,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el pago.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collect-payment-title"
        className="w-full max-w-md space-y-4 rounded-2xl border border-goldLight/15 bg-card p-5 shadow-xl sm:p-6"
      >
        <div>
          <h2 id="collect-payment-title" className="text-lg font-bold text-text">
            Cobrar saldo
          </h2>
          <p className="text-sm text-textMuted">
            Saldo pendiente: <strong className="text-goldLight">{formatPesos(balance)}</strong>. Cobralo con el posnet
            (u otro medio) y registralo acá.
          </p>
        </div>

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Medio de pago
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
            className={inputClasses}
          >
            {METHOD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Monto
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            max={balance}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
            className={inputClasses}
          />
          {remaining !== null && remaining > 0 && (
            <span className="text-xs">Pago parcial: queda pendiente {formatPesos(remaining)}.</span>
          )}
        </label>

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          N° de cupón u operación (opcional)
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={MAX_REFERENCE_LENGTH}
            className={inputClasses}
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
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
          >
            {isSubmitting ? 'Registrando…' : isValid && !exceeds ? `Registrar pago de ${formatPesos(parsed)}` : 'Registrar pago'}
          </button>
        </div>
      </form>
    </div>
  );
}
