import apiClient, { API_BASE_URL } from '@/config/api';
import type { PrepaymentFormData, ReservationSummary } from '@/config/types';

/**
 * El back devuelve columnas `date` de MikroORM, que llegan como `2026-10-10` o
 * como ISO completo según la hidratación. Normalizamos siempre a YYYY-MM-DD.
 */
const toPlainDate = (value: string): string => value.slice(0, 10);

export const getReservationSummary = async (reservationId: string): Promise<ReservationSummary> => {
  const { data } = await apiClient.get<ReservationSummary>(`/payment/${reservationId}/summary`);
  return data;
};

export const summaryToFormData = (summary: ReservationSummary): PrepaymentFormData => ({
  guest: summary.guestFullName,
  typeRoom: summary.roomCategoryName || 'Habitación estándar',
  checkIn: toPlainDate(summary.checkIn),
  checkOut: toPlainDate(summary.checkOut),
  totalStay: Number(summary.totalAmount),
  advancePayment: Number(summary.depositAmount),
  currency: 'ARS',
  reservationCode: summary.id,
});

/** Manda al huésped al checkout de Mercado Pago generado para esta reserva. */
export const goToCheckout = (initPoint: string | null): void => {
  if (!initPoint) {
    throw new Error('La reserva todavía no tiene un link de pago disponible.');
  }

  window.location.assign(initPoint);
};

/**
 * URL del comprobante en PDF. Con `inline` el back lo sirve para verlo en el navegador (y de ahí
 * imprimirlo); sin eso manda el header de descarga.
 */
export const getReceiptUrl = (reservationId: string, { inline = false } = {}): string =>
  `${API_BASE_URL}/payment/receipt/${reservationId}${inline ? '?inline=1' : ''}`;
