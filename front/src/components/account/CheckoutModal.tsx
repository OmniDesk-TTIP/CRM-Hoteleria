import { useState } from 'react';
import type { CheckoutBlock, CheckoutResult } from '@/config/types';
import { formatPesos } from './accountFormat';

interface CheckoutModalProps {
  guestFullName: string;
  roomNumber: string;
  /** Hace el checkout; con `force` aunque haya consumos en curso. */
  onCheckout: (force: boolean) => Promise<CheckoutResult>;
  onClose: () => void;
  /** Si el back pide cobrar el saldo, el modal ofrece ir directo al cobro. */
  onCollect: () => void;
}

/**
 * US-28: confirma el checkout. Si el back lo rechaza muestra por qué: saldo pendiente (con acceso al
 * cobro), consumos en curso (con "Hacer checkout igual") u otro motivo.
 */
export default function CheckoutModal({ guestFullName, roomNumber, onCheckout, onClose, onCollect }: CheckoutModalProps) {
  const [block, setBlock] = useState<CheckoutBlock | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (force: boolean) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await onCheckout(force);
      if (!result.ok) setBlock(result.block);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo hacer el checkout.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const owes = block?.code === 'CHECKOUT_PENDING_BALANCE' && block.balance > 0;
  const activeServices = block?.code === 'CHECKOUT_ACTIVE_SERVICES' ? block.activeServices : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="w-full max-w-md space-y-4 rounded-2xl border border-goldLight/15 bg-card p-5 shadow-xl sm:p-6"
      >
        <div>
          <h2 id="checkout-title" className="text-lg font-bold text-text">
            Checkout
          </h2>
          <p className="text-sm text-textMuted">
            {guestFullName} · Hab. {roomNumber}. Se cierra la cuenta y la estadía queda finalizada: después no se pueden
            cargar ni cobrar movimientos.
          </p>
        </div>

        {block && (
          <div role="alert" className="space-y-2 rounded-lg border border-gold/30 bg-gold/10 p-3 text-sm text-text">
            <p>{block.message}</p>
            {block.code === 'CHECKOUT_PENDING_BALANCE' && owes && (
              <p className="text-textMuted">Cobrá {formatPesos(block.balance)} antes de hacer el checkout.</p>
            )}
            {activeServices && (
              <ul className="list-disc space-y-0.5 pl-5 text-textMuted">
                {activeServices.map((service) => (
                  <li key={service.id}>{service.description}</li>
                ))}
              </ul>
            )}
          </div>
        )}

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
            {block ? 'Cerrar' : 'Cancelar'}
          </button>

          {owes && (
            <button
              type="button"
              onClick={onCollect}
              className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight motion-reduce:transition-none"
            >
              Cobrar saldo
            </button>
          )}

          {activeServices && (
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={isSubmitting}
              className="rounded-xl bg-danger/90 px-4 py-2 font-medium text-white transition hover:bg-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? 'Haciendo checkout…' : 'Hacer checkout igual'}
            </button>
          )}

          {!block && (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={isSubmitting}
              className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
            >
              {isSubmitting ? 'Haciendo checkout…' : 'Hacer checkout'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
