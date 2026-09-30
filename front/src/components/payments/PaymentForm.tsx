import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PrepaymentFormProps } from '@/config/types';

/**
 * Estado local del formulario. Ojo: acá NO vive el "pagado". Que la seña esté abonada lo dice
 * solamente la reserva en la base (prop `alreadyPaid`), nunca el hecho de haber tocado el botón.
 */
type Status = 'idle' | 'redirecting';

const formatCurrency = (value: number, currency: string) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (iso: string) => {
  // Las fechas llegan como YYYY-MM-DD: sin la hora el navegador las interpreta
  // en UTC y en AR (UTC-3) terminaría mostrando el día anterior.
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date);
};

const countNights = (checkIn: string, checkOut: string) => {
  const arrival = new Date(`${checkIn.slice(0, 10)}T00:00:00`);
  const departure = new Date(`${checkOut.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(arrival.getTime()) || Number.isNaN(departure.getTime())) return 0;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.max(Math.round((departure.getTime() - arrival.getTime()) / MS_PER_DAY), 0);
};

export default function PaymentForm({
  reservation,
  alreadyPaid = false,
  onConfirmedPayment,
}: PrepaymentFormProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const currency = reservation.currency ?? 'ARS';

  // La única fuente de verdad del pago es la reserva que trajimos de la API.
  const isPaid = alreadyPaid;
  const isRedirecting = status === 'redirecting';

  useEffect(() => {
    // Al volver con el botón "atrás" el navegador puede restaurar la página desde el bfcache con
    // el estado JS congelado en "redirecting". Como el huésped está de nuevo acá, se puede pagar.
    const resetOnReturn = () => setStatus('idle');

    window.addEventListener('pageshow', resetOnReturn);
    return () => window.removeEventListener('pageshow', resetOnReturn);
  }, []);

  const remainingBalance = useMemo(
    () => Math.max(reservation.totalStay - reservation.advancePayment, 0),
    [reservation.totalStay, reservation.advancePayment],
  );

  const depositPercentage = useMemo(() => {
    if (reservation.totalStay <= 0) return 0;
    return Math.min(100, Math.round((reservation.advancePayment / reservation.totalStay) * 100));
  }, [reservation.totalStay, reservation.advancePayment]);

  const nights = useMemo(
    () => countNights(reservation.checkIn, reservation.checkOut),
    [reservation.checkIn, reservation.checkOut],
  );

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isPaid || isRedirecting) return;

    setStatus('redirecting');
    setError(null);
    try {
      await onConfirmedPayment?.(reservation);
      // Si salió bien estamos yéndonos a Mercado Pago, así que el formulario queda en
      // "redirecting" a propósito: dar por pagada la seña acá sería mentirle al huésped.
    } catch (paymentError) {
      console.error('No se pudo iniciar el pago de la seña', paymentError);
      setError(
        paymentError instanceof Error
          ? paymentError.message
          : 'No pudimos iniciar el pago. Probá de nuevo en unos minutos.',
      );
      setStatus('idle');
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-shell px-4 py-10">
      {/* resplandor dorado detrás de la card, en referencia al orbe del AI Assistant del mockup */}
      <div
        className="pointer-events-none absolute h-72 w-72 rounded-full bg-gold/20 blur-3xl"
        aria-hidden
      />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-md rounded-3xl border border-goldLight/25 bg-card p-7 shadow-2xl shadow-black/40 sm:p-9"
      >
        {/* encabezado */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-poppins text-sm font-semibold text-goldLight/80">OmniDesk</p>
            <h1 className="mt-1 font-poppins text-2xl font-bold text-goldLight">
              Confirmá tu reserva
            </h1>
          </div>
          <span
            className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
              isPaid ? 'bg-success/20 text-successText' : 'bg-gold/15 text-goldLight'
            }`}
          >
            {isPaid ? 'Seña confirmada' : 'Pendiente de seña'}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-textMuted">
          {isPaid
            ? 'Ya recibimos tu seña: la habitación está confirmada a tu nombre.'
            : 'Revisá los datos de tu estadía y aboná la seña para asegurar la habitación.'}
        </p>

        {/* datos de la reserva */}
        <dl className="mt-6 divide-y divide-goldLight/10 border-y border-goldLight/10">
          <DetailRow label="Huésped" value={reservation.guest} />
          <DetailRow label="Tipo de habitación" value={reservation.typeRoom} />
          <DetailRow label="Check-in" value={formatDate(reservation.checkIn)} />
          <DetailRow label="Check-out" value={formatDate(reservation.checkOut)} />
          {nights > 0 && (
            <DetailRow label="Noches" value={`${nights} ${nights === 1 ? 'noche' : 'noches'}`} />
          )}
        </dl>

        {/* total y seña */}
        <div className="mt-6 rounded-2xl bg-surface p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-textMuted">Total de la estadía</p>
              <p className="mt-1 font-poppins text-xl font-semibold text-goldLight">
                {formatCurrency(reservation.totalStay, currency)}
              </p>
            </div>
            <div className="h-10 w-px bg-goldLight/15" aria-hidden />
            <div className="text-right">
              <p className="text-xs text-textMuted">Seña a abonar</p>
              <p className="mt-1 font-poppins text-xl font-semibold text-gold">
                {formatCurrency(reservation.advancePayment, currency)}
              </p>
            </div>
          </div>

          {/* barra de progreso, en referencia a la barra "Available / Occ %" del mockup */}
          <div className="mt-4">
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-shell"
              role="progressbar"
              aria-valuenow={depositPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Porcentaje de la estadía cubierto por la seña"
            >
              <div
                className="h-full rounded-full bg-gold transition-all motion-reduce:transition-none"
                style={{ width: `${depositPercentage}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-textMuted">
              <span>Seña {depositPercentage}%</span>
              <span>Saldo restante {formatCurrency(remainingBalance, currency)}</span>
            </div>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-danger/15 px-4 py-3 text-sm text-dangerText">
            {error}
          </p>
        )}

        {/* acción */}
        <button
          type="submit"
          disabled={isPaid || isRedirecting}
          className="mt-6 w-full rounded-full bg-gold py-3 text-sm font-semibold text-shell transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          {isPaid
            ? 'Seña abonada ✓'
            : isRedirecting
              ? 'Te llevamos a Mercado Pago…'
              : `Pagar seña de ${formatCurrency(reservation.advancePayment, currency)}`}
        </button>

        {reservation.reservationCode && (
          <p className="mt-4 text-center text-xs text-textMuted">
            Reserva {reservation.reservationCode}
          </p>
        )}
      </form>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-sm text-textMuted">{label}</dt>
      <dd className="text-sm font-medium text-text">{value}</dd>
    </div>
  );
}
