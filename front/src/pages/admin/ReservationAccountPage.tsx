import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getReservationAccount, openReservationAccount } from '@/services/account.service';
import type { AccountEntryOrigin, AccountEntryType, PaymentMethod, ReservationAccount } from '@/config/types';
import AccountSummary from '@/components/account/AccountSummary';
import AccountEntriesTable from '@/components/account/AccountEntriesTable';
import OpenAccountCard from '@/components/account/OpenAccountCard';
import { ENTRY_ORIGIN_LABELS, ENTRY_TYPE_LABELS } from '@/components/account/accountFormat';
import { formatIsoDay } from '@/components/admin/spaFormat';

type TypeFilter = AccountEntryType | 'ALL';
type OriginFilter = AccountEntryOrigin | 'ALL';

const TYPE_OPTIONS = Object.entries(ENTRY_TYPE_LABELS) as [AccountEntryType, string][];
const ORIGIN_OPTIONS = Object.entries(ENTRY_ORIGIN_LABELS) as [AccountEntryOrigin, string][];

const selectClasses =
  'rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

/** US-32: cuenta corriente de una reserva confirmada. */
export default function ReservationAccountPage() {
  const { reservationId = '' } = useParams<{ reservationId: string }>();
  const [data, setData] = useState<ReservationAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [originFilter, setOriginFilter] = useState<OriginFilter>('ALL');

  // Reserva que la página muestra ahora: una respuesta que llega después de cambiar de reserva
  // (o de salir de la página) se descarta en vez de pisar los datos de la nueva.
  const activeReservationRef = useRef(reservationId);

  const fetchAccount = useCallback(
    async (isActive: () => boolean = () => true) => {
      setIsLoading(true);
      setError(null);
      setData(null);
      try {
        const result = await getReservationAccount(reservationId);
        if (isActive()) setData(result);
      } catch (err: unknown) {
        if (isActive()) setError(err instanceof Error ? err.message : 'Error al cargar la cuenta corriente.');
      } finally {
        if (isActive()) setIsLoading(false);
      }
    },
    [reservationId],
  );

  useEffect(() => {
    let active = true;
    activeReservationRef.current = reservationId;
    fetchAccount(() => active);
    return () => {
      active = false;
    };
  }, [fetchAccount, reservationId]);

  const handleOpen = async (paymentMethod: PaymentMethod) => {
    const result = await openReservationAccount(reservationId, paymentMethod);
    if (activeReservationRef.current === reservationId) setData(result);
  };

  const entries = useMemo(
    () =>
      (data?.account?.entries ?? []).filter(
        (entry) =>
          (typeFilter === 'ALL' || entry.type === typeFilter) &&
          (originFilter === 'ALL' || entry.origin === originFilter),
      ),
    [data, typeFilter, originFilter],
  );

  const reservation = data?.reservation;
  const account = data?.account;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div>
        <Link
          to="/admin/reservations"
          className="text-sm text-textMuted transition hover:text-goldLight motion-reduce:transition-none"
        >
          ← Volver a reservas
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-text">Cuenta corriente</h1>
        {reservation && (
          <p className="text-sm text-textMuted">
            {reservation.guestFullName} · DNI {reservation.guestDni} · {reservation.categoryName} · Hab.{' '}
            {reservation.roomNumber} · {formatIsoDay(reservation.checkIn)} al {formatIsoDay(reservation.checkOut)}
          </p>
        )}
      </div>

      {isLoading && <p className="py-10 text-center text-textMuted">Cargando cuenta corriente…</p>}

      {!isLoading && error && (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/10 p-4 text-sm text-dangerText">
          {error}
          <button type="button" onClick={() => fetchAccount(() => activeReservationRef.current === reservationId)} className="ml-3 underline">
            Reintentar
          </button>
        </div>
      )}

      {!isLoading && !error && reservation && !account && (
        <OpenAccountCard reservation={reservation} onOpen={handleOpen} />
      )}

      {!isLoading && !error && account && (
        <>
          <AccountSummary account={account} />

          <section className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
            <div className="flex flex-col gap-3 border-b border-goldLight/10 p-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
              <h2 className="text-lg font-semibold text-text">Movimientos</h2>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex flex-col gap-1 text-sm text-textMuted">
                  Tipo
                  <select
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                    className={selectClasses}
                  >
                    <option value="ALL">Todos</option>
                    {TYPE_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm text-textMuted">
                  Origen
                  <select
                    value={originFilter}
                    onChange={(e) => setOriginFilter(e.target.value as OriginFilter)}
                    className={selectClasses}
                  >
                    <option value="ALL">Todos</option>
                    {ORIGIN_OPTIONS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            <AccountEntriesTable entries={entries} hasAnyEntry={account.entries.length > 0} />
          </section>
        </>
      )}
    </div>
  );
}
