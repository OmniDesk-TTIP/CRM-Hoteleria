import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ReservationSummary } from '@/config/types';
import { getReceiptUrl, getReservationSummary } from '@/services/payment.service';
import StatusScreen from '@/components/payments/PostPayment';

/** Cada cuánto y cuántas veces reintentamos mientras el pago todavía no figura acreditado. */
const RETRY_INTERVAL_MS = 3000;
const MAX_RETRIES = 10;

interface LoadState {
  id?: string;
  summary: ReservationSummary | null;
  error: string | null;
}

export default function PaymentSuccessPage() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const [load, setLoad] = useState<LoadState>({ summary: null, error: null });
  const [retries, setRetries] = useState(0);

  const isLoading = Boolean(reservationId) && load.id !== reservationId;

  const fetchSummary = useCallback(() => {
    if (!reservationId) return;

    getReservationSummary(reservationId)
      .then((data) => setLoad({ id: reservationId, summary: data, error: null }))
      .catch((loadError: unknown) => {
        console.error('No se pudo cargar la reserva', loadError);
        setLoad({
          id: reservationId,
          summary: null,
          error: 'No pudimos leer el estado de tu reserva. Escribinos por Telegram y lo vemos.',
        });
      });
  }, [reservationId]);

  useEffect(fetchSummary, [fetchSummary]);

  const isPending = load.summary?.status === 'PENDING_PAYMENT';

  useEffect(() => {
    // Mercado Pago nos devuelve apenas termina el pago, así que puede que la acreditación todavía
    // esté viajando por el webhook. Reintentamos un rato en vez de dar por fallado el pago.
    if (!isPending || retries >= MAX_RETRIES) return;

    const timer = setTimeout(() => {
      setRetries((count) => count + 1);
      fetchSummary();
    }, RETRY_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [isPending, retries, fetchSummary]);

  /** El chequeo manual arranca la tanda de reintentos de nuevo. */
  const checkAgain = () => {
    setRetries(0);
    fetchSummary();
  };

  if (!reservationId) {
    return (
      <StatusScreen
        badge={<SuccessBadge />}
        title="¡Recibimos tu pago!"
        detail="Te mandamos el detalle de la reserva por Telegram."
      />
    );
  }

  if (isLoading) return <StatusScreen title="Verificando tu pago…" />;

  const { summary } = load;

  if (load.error || !summary) {
    return (
      <StatusScreen
        title="No pudimos verificar tu pago"
        detail={load.error ?? 'Intentá de nuevo en unos minutos.'}
      />
    );
  }

  if (summary.status === 'CANCELLED') {
    return (
      <StatusScreen
        title="Esta reserva fue cancelada"
        detail="Si pagaste igual, escribinos por Telegram con el código de reserva y lo resolvemos."
      />
    );
  }

  if (summary.status === 'PENDING_PAYMENT') {
    const outOfRetries = retries >= MAX_RETRIES;

    return (
      <StatusScreen
        title={outOfRetries ? 'Tu pago sigue procesándose' : 'Estamos acreditando tu pago…'}
        detail={
          outOfRetries
            ? 'Mercado Pago todavía no nos confirmó la operación. Apenas se acredite te avisamos por Telegram y tu reserva queda confirmada.'
            : 'Esto puede tardar unos segundos. No cierres la página.'
        }
      >
        <button
          type="button"
          onClick={checkAgain}
          className="mt-6 w-full rounded-full border border-goldLight/30 py-3 text-sm font-semibold text-goldLight transition hover:bg-goldLight/10 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        >
          Volver a chequear
        </button>
        <p className="mt-4 text-xs text-textMuted">Reserva {summary.id}</p>
      </StatusScreen>
    );
  }

  return (
    <StatusScreen
      badge={<SuccessBadge />}
      title="¡Pago acreditado!"
      detail={`Tu reserva del ${formatDate(summary.checkIn)} al ${formatDate(summary.checkOut)} quedó confirmada. Te esperamos.`}
    >
      <dl className="mt-6 divide-y divide-goldLight/10 border-y border-goldLight/10 text-left">
        <DetailRow label="Huésped" value={summary.guestFullName} />
        <DetailRow label="Habitación" value={summary.roomCategoryName || 'Habitación estándar'} />
        <DetailRow label="Seña abonada" value={formatCurrency(summary.depositAmount)} />
        <DetailRow label="Saldo al llegar" value={formatCurrency(Math.max(summary.totalAmount - summary.depositAmount, 0))} />
      </dl>

      {/* El PDF lo sirve el back: inline para verlo e imprimirlo, o con header de descarga. */}
      <a
        href={getReceiptUrl(summary.id, { inline: true })}
        target="_blank"
        rel="noreferrer"
        className="mt-6 block w-full rounded-full bg-gold py-3 text-sm font-semibold text-shell transition hover:brightness-105 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
      >
        Imprimir comprobante
      </a>
      <a
        href={getReceiptUrl(summary.id)}
        className="mt-3 inline-block text-xs text-textMuted underline underline-offset-4 transition hover:text-goldLight motion-reduce:transition-none"
      >
        Descargarlo en PDF
      </a>

      <p className="mt-5 text-xs text-textMuted">Reserva {summary.id}</p>
    </StatusScreen>
  );
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));

const formatDate = (iso: string) => {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short' }).format(date);
};

function SuccessBadge() {
  return (
    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/20 text-successText">
      <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    </span>
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
