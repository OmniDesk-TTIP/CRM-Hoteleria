import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  checkoutReservation,
  getReservationAccount,
  openReservationAccount,
  registerAccountCharge,
  registerAccountPayment,
  reverseAccountCharge,
} from '@/services/account.service';
import type {
  AccountEntry,
  AccountPaymentData,
  AccountEntryOrigin,
  AccountEntryType,
  ManualChargeData,
  PaymentMethod,
  ReservationAccount,
} from '@/config/types';
import { useAuth } from '@/context/auth.context';
import AccountSummary from '@/components/account/AccountSummary';
import AccountEntriesTable from '@/components/account/AccountEntriesTable';
import OpenAccountCard from '@/components/account/OpenAccountCard';
import AddChargeModal from '@/components/account/AddChargeModal';
import ReverseChargeModal from '@/components/account/ReverseChargeModal';
import CollectPaymentModal from '@/components/account/CollectPaymentModal';
import CheckoutModal from '@/components/account/CheckoutModal';
import { formatEntryDateTime } from '@/components/account/accountFormat';
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
  const [isAddingCharge, setIsAddingCharge] = useState(false);
  const [isCollecting, setIsCollecting] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [reversing, setReversing] = useState<AccountEntry | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

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

  // los modales muestran el error si falla: acá solo se cierra el modal cuando salió bien
  const handleAddCharge = async (charge: ManualChargeData) => {
    const result = await registerAccountCharge(reservationId, charge);
    if (activeReservationRef.current === reservationId) setData(result);
    setIsAddingCharge(false);
  };

  const handleCollect = async (payment: AccountPaymentData) => {
    const result = await registerAccountPayment(reservationId, payment);
    if (activeReservationRef.current === reservationId) setData(result);
    setIsCollecting(false);
  };

  const handleCheckout = async (force: boolean) => {
    const result = await checkoutReservation(reservationId, force);
    if (result.ok) {
      if (activeReservationRef.current === reservationId) setData(result.account);
      setIsCheckingOut(false);
    }
    return result;
  };

  const handleReverse = async (reason: string) => {
    if (!reversing) return;
    const result = await reverseAccountCharge(reservationId, reversing.id, reason);
    if (activeReservationRef.current === reservationId) setData(result);
    setReversing(null);
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
  const isOpen = account?.status === 'OPEN';
  const canCheckout = isOpen && !reservation?.checkedOutAt;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-6">
      <div>
        <Link
          to="/admin/reservations"
          className="text-sm text-textMuted transition hover:text-goldLight motion-reduce:transition-none"
        >
          ← Volver a reservas
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold text-text">Cuenta corriente</h1>
          {!isLoading && !error && canCheckout && (
            <button
              type="button"
              onClick={() => setIsCheckingOut(true)}
              className="rounded-xl border border-goldLight/30 px-4 py-2 text-sm font-medium text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none"
            >
              Hacer checkout
            </button>
          )}
        </div>
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

      {!isLoading && !error && reservation?.checkedOutAt && (
        <div role="status" className="rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-successText">
          Checkout hecho el {formatEntryDateTime(reservation.checkedOutAt)}
          {reservation.checkedOutByName ? ` por ${reservation.checkedOutByName}` : ''}. La estadía está finalizada y la
          cuenta, cerrada.
        </div>
      )}

      {!isLoading && !error && account && (
        <>
          <AccountSummary account={account} onCollect={isOpen ? () => setIsCollecting(true) : undefined} />

          <section className="overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
            <div className="flex flex-col gap-3 border-b border-goldLight/10 p-4 sm:flex-row sm:items-end sm:justify-between sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-text">Movimientos</h2>
                {isOpen && (
                  <button
                    type="button"
                    onClick={() => setIsAddingCharge(true)}
                    className="rounded-xl bg-gold px-4 py-2 text-sm font-medium text-shell transition hover:bg-goldLight motion-reduce:transition-none sm:hidden"
                  >
                    + Cargar consumo
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                {isOpen && (
                  <button
                    type="button"
                    onClick={() => setIsAddingCharge(true)}
                    className="hidden rounded-xl bg-gold px-4 py-2 text-sm font-medium text-shell transition hover:bg-goldLight motion-reduce:transition-none sm:block"
                  >
                    + Cargar consumo
                  </button>
                )}
              </div>
            </div>

            <AccountEntriesTable
              entries={entries}
              hasAnyEntry={account.entries.length > 0}
              onReverse={isAdmin && isOpen ? setReversing : undefined}
            />
          </section>
        </>
      )}

      {isAddingCharge && <AddChargeModal onClose={() => setIsAddingCharge(false)} onSubmit={handleAddCharge} />}

      {isCollecting && account && (
        <CollectPaymentModal
          balance={account.balance}
          onClose={() => setIsCollecting(false)}
          onSubmit={handleCollect}
        />
      )}

      {isCheckingOut && reservation && (
        <CheckoutModal
          guestFullName={reservation.guestFullName}
          roomNumber={reservation.roomNumber}
          onCheckout={handleCheckout}
          onClose={() => setIsCheckingOut(false)}
          onCollect={() => {
            setIsCheckingOut(false);
            setIsCollecting(true);
          }}
        />
      )}

      {reversing && (
        <ReverseChargeModal entry={reversing} onClose={() => setReversing(null)} onSubmit={handleReverse} />
      )}
    </div>
  );
}
