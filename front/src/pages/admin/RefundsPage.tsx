import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/auth.context';
import { completeRefund, listRefunds } from '@/services/cancellation.service';
import type { Refund, RefundListFilters, RefundStatus } from '@/config/types';
import Pagination from '@/components/admin/Pagination';
import { formatDateTime, formatDay, formatMoney } from '@/components/admin/refundFormat';

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

const STATUS_OPTIONS: { value: RefundStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'COMPLETED', label: 'Realizadas' },
];

const inputClasses =
  'w-full min-w-0 rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 sm:w-auto';

const todayLocal = (): string => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

function RefundStatusBadge({ status }: { status: RefundStatus }) {
  const isPending = status === 'PENDING';
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
        isPending ? 'bg-gold/15 text-goldLight' : 'bg-success/20 text-successText'
      }`}
    >
      {isPending ? 'Pendiente' : 'Realizada'}
    </span>
  );
}

/** US-14 CA4 y CA5: devoluciones que generan las cancelaciones con reintegro. */
export default function RefundsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [filters, setFilters] = useState<RefundListFilters>({ page: 1, pageSize: 10, status: 'PENDING' });
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [completing, setCompleting] = useState<Refund | null>(null);
  const [refundedAt, setRefundedAt] = useState(todayLocal());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const fetchRefunds = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listRefunds(filters);
      setRefunds(result.data);
      setTotal(result.total);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Error al cargar las devoluciones.'));
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchRefunds();
  }, [fetchRefunds]);

  const openCompleteModal = (refund: Refund) => {
    setActionError(null);
    setModalError(null);
    setRefundedAt(todayLocal());
    setCompleting(refund);
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!completing) return;

    setIsSubmitting(true);
    setModalError(null);
    try {
      await completeRefund(completing.reservationId, refundedAt);
      setCompleting(null);
      fetchRefunds();
    } catch (err: unknown) {
      setModalError(errorMessage(err, 'Error al marcar la devolución como realizada.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const message = isLoading
    ? { text: 'Cargando devoluciones…', tone: 'text-textMuted' }
    : error
      ? { text: error, tone: 'text-dangerText' }
      : refunds.length === 0
        ? { text: 'No hay devoluciones para el filtro seleccionado.', tone: 'text-textMuted' }
        : null;
  const rows = message ? [] : refunds;

  const completeButton = (refund: Refund, className = '') =>
    isAdmin && refund.status === 'PENDING' ? (
      <button
        type="button"
        onClick={() => openCompleteModal(refund)}
        className={`rounded-full border border-goldLight/25 px-3 py-1.5 text-xs font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none ${className}`}
      >
        Marcar como realizada
      </button>
    ) : null;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Devoluciones</h1>
        <p className="text-sm text-textMuted">
          Reintegros de la seña por reservas pagadas que se cancelaron, según la política vigente al cancelar.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-goldLight/15 bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-textMuted">
          Estado
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as RefundStatus | 'ALL', page: 1 }))}
            className={inputClasses}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {actionError && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
          {actionError}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-goldLight/10 text-xs uppercase tracking-wide text-textMuted">
                <th className="px-4 py-3 font-medium sm:px-5">Reserva</th>
                <th className="px-4 py-3 font-medium sm:px-5">Huésped</th>
                <th className="px-4 py-3 font-medium sm:px-5">Monto</th>
                <th className="px-4 py-3 font-medium sm:px-5">Cancelación</th>
                <th className="px-4 py-3 font-medium sm:px-5">Estado</th>
                <th className="px-4 py-3 text-right font-medium sm:px-5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-goldLight/10">
              {message && (
                <tr>
                  <td colSpan={6} className={`px-5 py-10 text-center ${message.tone}`}>
                    {message.text}
                  </td>
                </tr>
              )}

              {rows.map((refund) => (
                <tr key={refund.reservationId} className="transition hover:bg-surface/50 motion-reduce:transition-none">
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                    <p className="text-text">
                      {formatDay(refund.checkIn)} — {formatDay(refund.checkOut)}
                    </p>
                    <p className="text-xs text-textMuted">Hab. {refund.roomNumber}</p>
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <p className="font-medium text-text">{refund.guestFullName}</p>
                    <p className="text-xs text-textMuted">{refund.guestDni}</p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">
                    <p className="font-medium text-text">{formatMoney(refund.amount)}</p>
                    <p className="text-xs text-textMuted">
                      {refund.percentage}% de la seña{refund.policyName ? ` · ${refund.policyName}` : ''}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5 text-text">{formatDateTime(refund.cancelledAt)}</td>
                  <td className="px-4 py-3 sm:px-5">
                    <RefundStatusBadge status={refund.status} />
                    {refund.refundedAt && (
                      <p className="mt-1 text-xs text-textMuted">el {formatDateTime(refund.refundedAt)}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    <div className="flex justify-end gap-2">{completeButton(refund)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lg:hidden">
          {message && <p className={`px-5 py-10 text-center text-sm ${message.tone}`}>{message.text}</p>}

          {rows.length > 0 && (
            <ul className="divide-y divide-goldLight/10">
              {rows.map((refund) => (
                <li key={refund.reservationId} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text">{refund.guestFullName}</p>
                      <p className="text-xs text-textMuted">DNI {refund.guestDni}</p>
                    </div>
                    <RefundStatusBadge status={refund.status} />
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <div>
                      <dt className="text-xs text-textMuted">Monto</dt>
                      <dd className="text-text">
                        {formatMoney(refund.amount)}
                        <span className="block text-xs text-textMuted">{refund.percentage}% de la seña</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-textMuted">Cancelación</dt>
                      <dd className="text-text">{formatDateTime(refund.cancelledAt)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-xs text-textMuted">Reserva</dt>
                      <dd className="text-text">
                        {formatDay(refund.checkIn)} — {formatDay(refund.checkOut)} · Hab. {refund.roomNumber}
                      </dd>
                    </div>
                    {refund.refundedAt && (
                      <div className="col-span-2">
                        <dt className="text-xs text-textMuted">Devuelta el</dt>
                        <dd className="text-text">{formatDateTime(refund.refundedAt)}</dd>
                      </div>
                    )}
                  </dl>

                  {completeButton(refund, 'w-full py-2')}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
        />
      </div>

      {completing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleComplete}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-goldLight/20 bg-card p-5 shadow-xl sm:p-6"
          >
            <h2 className="text-lg font-bold text-text">Marcar devolución como realizada</h2>
            <p className="text-sm text-textMuted">
              Devolución de <strong className="text-text">{formatMoney(completing.amount)}</strong> a{' '}
              <strong className="text-text">{completing.guestFullName}</strong>. Registrá la fecha en que se hizo.
            </p>

            {modalError && (
              <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-dangerText">
                {modalError}
              </div>
            )}

            <label className="flex flex-col gap-1 text-sm text-textMuted">
              Fecha de la devolución *
              <input
                required
                type="date"
                max={todayLocal()}
                value={refundedAt}
                onChange={(e) => setRefundedAt(e.target.value)}
                className={inputClasses}
              />
            </label>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setCompleting(null)}
                disabled={isSubmitting}
                className="rounded-xl px-4 py-2 font-medium text-textMuted transition hover:text-text"
              >
                Atrás
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !refundedAt}
                className="rounded-xl bg-gold px-4 py-2 font-medium text-shell transition hover:bg-goldLight disabled:opacity-50"
              >
                {isSubmitting ? 'Guardando...' : 'Confirmar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}