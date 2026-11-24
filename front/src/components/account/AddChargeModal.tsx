import { useState, type FormEvent } from 'react';
import type { ManualChargeData, ManualChargeOrigin } from '@/config/types';
import {
  ENTRY_ORIGIN_LABELS,
  formatPesos,
  hasTicket,
  MANUAL_CHARGE_ORIGINS,
  MAX_CHARGE_DETAIL_LENGTH,
  MAX_TICKET_NUMBER_LENGTH,
} from './accountFormat';

interface AddChargeModalProps {
  onClose: () => void;
  onSubmit: (charge: ManualChargeData) => Promise<void>;
}

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

/** Monto válido para el libro: mayor a cero y con hasta dos decimales. */
const parseAmount = (raw: string): number | null => {
  const amount = Number(raw.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 && Number(amount.toFixed(2)) === amount ? amount : null;
};

/** US-27: carga a la cuenta un consumo del restó o del bar (con su ticket) o un extra de recepción. */
export default function AddChargeModal({ onClose, onSubmit }: AddChargeModalProps) {
  // una clave por formulario: si el envío se reintenta (doble clic, red lenta), el back no lo duplica
  const [operationId] = useState(() => crypto.randomUUID());
  const [origin, setOrigin] = useState<ManualChargeOrigin>('RESTAURANT');
  const [amount, setAmount] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [detail, setDetail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withTicket = hasTicket(origin);
  const parsedAmount = parseAmount(amount);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parsedAmount === null) {
      setError('Ingresá un monto mayor a cero, con hasta dos decimales.');
      return;
    }
    if (!withTicket && !detail.trim()) {
      setError('Indicá qué se está cobrando.');
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        operationId,
        origin,
        amount: parsedAmount,
        ...(withTicket && ticketNumber.trim() ? { ticketNumber: ticketNumber.trim() } : {}),
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el consumo.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-charge-title"
        className="w-full max-w-md space-y-4 rounded-2xl border border-goldLight/15 bg-card p-5 shadow-xl sm:p-6"
      >
        <div>
          <h2 id="add-charge-title" className="text-lg font-bold text-text">
            Cargar consumo
          </h2>
          <p className="text-sm text-textMuted">Se suma a la cuenta y el huésped lo paga al final de la estadía.</p>
        </div>

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          Origen
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value as ManualChargeOrigin)}
            className={inputClasses}
          >
            {MANUAL_CHARGE_ORIGINS.map((value) => (
              <option key={value} value={value}>
                {ENTRY_ORIGIN_LABELS[value]}
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
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            required
            autoFocus
            className={inputClasses}
          />
        </label>

        {withTicket && (
          <label className="flex flex-col gap-1 text-sm text-textMuted">
            N° de ticket (opcional)
            <input
              type="text"
              value={ticketNumber}
              onChange={(e) => setTicketNumber(e.target.value)}
              maxLength={MAX_TICKET_NUMBER_LENGTH}
              className={inputClasses}
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm text-textMuted">
          {withTicket ? 'Detalle (opcional)' : 'Qué se cobra'}
          <input
            type="text"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={MAX_CHARGE_DETAIL_LENGTH}
            placeholder={
              origin === 'RESTAURANT' ? 'Cena para 2' : origin === 'BAR' ? '2 tragos' : 'Lavandería, frigobar…'
            }
            required={!withTicket}
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
            {isSubmitting
              ? 'Cargando…'
              : parsedAmount !== null
                ? `Cargar ${formatPesos(parsedAmount)}`
                : 'Cargar consumo'}
          </button>
        </div>
      </form>
    </div>
  );
}
