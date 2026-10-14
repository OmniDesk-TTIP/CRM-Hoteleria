import { useEffect, useState } from 'react';
import type { AdminReservation, CancellationPolicy } from '@/config/types';
import { listCancellationPolicies } from '@/services/cancellation.service';
import { estimateRefund, formatMoney } from './refundFormat';

interface ConfirmCancelModalProps {
  reservation: AdminReservation;
  onClose: () => void;
  onConfirm: () => void;
}

export default function ConfirmCancelModal({ reservation, onClose, onConfirm }: ConfirmCancelModalProps) {
  const isPaid = reservation.status === 'CONFIRMED';

  const [policy, setPolicy] = useState<CancellationPolicy | null>(null);
  const [isLoadingPolicy, setIsLoadingPolicy] = useState(isPaid);
  const [policyError, setPolicyError] = useState(false);

  useEffect(() => {
    if (!isPaid) return;

    let cancelled = false;
    listCancellationPolicies()
      .then((policies) => {
        if (!cancelled) setPolicy(policies.find((candidate) => candidate.active) ?? null);
      })
      .catch(() => {
        if (!cancelled) setPolicyError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPolicy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isPaid]);

  const estimate = isPaid && !policyError ? estimateRefund(policy, reservation) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-danger/20 bg-card p-5 text-center shadow-xl sm:p-6">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
          <span className="text-xl text-dangerText">⚠</span>
        </div>
        <h2 className="mb-2 text-lg font-bold text-text">¿Cancelar Reserva?</h2>
        <p className="mb-4 text-sm text-textMuted">
          Estás por cancelar la reserva de <strong>{reservation.guestFullName}</strong> (Check-in:{' '}
          {new Date(`${reservation.checkIn}T00:00:00`).toLocaleDateString('es-AR')}). La habitación{' '}
          {reservation.room.roomNumber} quedará liberada inmediatamente.
        </p>

        {isPaid && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-goldLight/20 bg-surface p-3 text-left text-sm text-textMuted"
          >
            {isLoadingPolicy ? (
              'Calculando la devolución…'
            ) : policyError ? (
              'No pude consultar la política de cancelación; la devolución se calcula igual al cancelar.'
            ) : !policy ? (
              'No hay una política de cancelación vigente: la seña no se devuelve.'
            ) : estimate && estimate.amount > 0 ? (
              <>
                Política <strong className="text-text">{policy.name}</strong>: faltan {estimate.daysInAdvance}{' '}
                {estimate.daysInAdvance === 1 ? 'día' : 'días'} para el check-in, se devuelve el {estimate.percentage}% de
                la seña: <strong className="text-text">{formatMoney(estimate.amount)}</strong>. Queda como devolución
                pendiente.
              </>
            ) : (
              <>
                Política <strong className="text-text">{policy.name}</strong>: con esta anticipación no corresponde
                devolución de la seña ({formatMoney(reservation.depositAmount)}).
              </>
            )}
          </div>
        )}

        <p className="mb-6 text-sm text-textMuted">Esta acción no se puede deshacer.</p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-center sm:gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text"
          >
            Atrás
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-danger/90 px-4 py-2 font-medium text-white transition hover:bg-danger"
          >
            Sí, cancelar reserva
          </button>
        </div>
      </div>
    </div>
  );
}