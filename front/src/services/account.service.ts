import apiClient from '@/config/api';
import type { PaymentMethod, ReservationAccount } from '@/config/types';

export const getReservationAccount = async (reservationId: string): Promise<ReservationAccount> => {
  const { data } = await apiClient.get<ReservationAccount>(`/reservations/${reservationId}/account`);
  return data;
};

/** Registra el pago del resto de la estadía; con eso el back abre la cuenta. */
export const openReservationAccount = async (
  reservationId: string,
  paymentMethod: PaymentMethod,
): Promise<ReservationAccount> => {
  const { data } = await apiClient.post<ReservationAccount>(`/reservations/${reservationId}/account`, {
    paymentMethod,
  });
  return data;
};
