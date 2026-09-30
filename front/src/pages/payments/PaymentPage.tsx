import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ReservationSummary } from '@/config/types';
import { getReservationSummary, goToCheckout, summaryToFormData } from '@/services/payment.service';
import PaymentForm from '../../components/payments/PaymentForm';
import PostPayment from '@/components/payments/PostPayment';

/** Resultado de la última carga, junto al id al que corresponde. */
interface LoadState {
  id?: string;
  summary: ReservationSummary | null;
  error: string | null;
}

export default function PaymentPage() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const [load, setLoad] = useState<LoadState>({ summary: null, error: null });

  // Derivado en vez de un estado aparte: mientras lo cargado no sea de este id,
  // la pantalla sigue en "cargando" (incluso si el link cambia de reserva).
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
          error: 'No encontramos esa reserva. Revisá el link que te enviamos.',
        });
      });
  }, [reservationId]);

  useEffect(fetchSummary, [fetchSummary]);

  useEffect(() => {
    // El estado del pago lo define la reserva en la base, no lo que haya hecho esta pantalla.
    // Cuando el huésped vuelve de Mercado Pago (pestaña que se vuelve visible) o pega la vuelta
    // con el botón "atrás" (restaurada desde el bfcache), releemos para ver cómo quedó.
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') fetchSummary();
    };
    const refreshOnRestore = (event: PageTransitionEvent) => {
      if (event.persisted) fetchSummary();
    };

    document.addEventListener('visibilitychange', refreshIfVisible);
    window.addEventListener('pageshow', refreshOnRestore);

    return () => {
      document.removeEventListener('visibilitychange', refreshIfVisible);
      window.removeEventListener('pageshow', refreshOnRestore);
    };
  }, [fetchSummary]);

  const { summary } = load;

  const handleConfirmedPayment = useCallback(() => {
    goToCheckout(summary?.initPoint ?? null);
  }, [summary]);

  if (!reservationId) {
    return (
      <PostPayment
        title="Falta el código de reserva"
        detail="Entrá desde el link que te mandamos por Telegram para ver tu reserva."
      />
    );
  }

  if (isLoading) return <PostPayment title="Cargando tu reserva…" />;

  if (load.error || !summary) {
    return (
      <PostPayment
        title="No pudimos mostrar tu reserva"
        detail={load.error ?? 'Intentá de nuevo en unos minutos.'}
      />
    );
  }

  if (summary.status === 'CANCELLED') {
    return (
      <PostPayment
        title="Esta reserva fue cancelada"
        detail="El tiempo para abonar la seña venció. Escribinos por Telegram para reservar de nuevo."
      />
    );
  }

  return (
    <PaymentForm
      reservation={summaryToFormData(summary)}
      alreadyPaid={summary.status === 'CONFIRMED'}
      onConfirmedPayment={handleConfirmedPayment}
    />
  );
}
