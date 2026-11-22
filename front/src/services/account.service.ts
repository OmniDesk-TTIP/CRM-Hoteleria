import apiClient from '@/config/api';
import type { ManualChargeData, PaymentMethod, ReservationAccount } from '@/config/types';

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

/** US-27: carga un consumo del restó o de recepción a la cuenta. */
export const registerAccountCharge = async (
  reservationId: string,
  charge: ManualChargeData,
): Promise<ReservationAccount> => {
  const { data } = await apiClient.post<ReservationAccount>(`/reservations/${reservationId}/account/charges`, charge);
  return data;
};

/** US-27: anula un consumo cargado a mano (solo administradores). */
export const reverseAccountCharge = async (
  reservationId: string,
  entryId: string,
  reason: string,
): Promise<ReservationAccount> => {
  const { data } = await apiClient.post<ReservationAccount>(
    `/reservations/${reservationId}/account/charges/${entryId}/reversal`,
    { reason },
  );
  return data;
};
