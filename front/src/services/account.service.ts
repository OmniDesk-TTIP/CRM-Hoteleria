import { isAxiosError } from 'axios';
import apiClient from '@/config/api';
import type {
  AccountPaymentData,
  CheckoutBlock,
  CheckoutResult,
  ManualChargeData,
  PaymentMethod,
  ReservationAccount,
} from '@/config/types';

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

/** US-28: registra un pago (total o parcial) del saldo pendiente. */
export const registerAccountPayment = async (
  reservationId: string,
  payment: AccountPaymentData,
): Promise<ReservationAccount> => {
  const { data } = await apiClient.post<ReservationAccount>(`/reservations/${reservationId}/account/payments`, payment);
  return data;
};

const isCheckoutBlock = (data: unknown): data is CheckoutBlock =>
  typeof data === 'object' &&
  data !== null &&
  typeof (data as { code?: unknown }).code === 'string' &&
  (data as { code: string }).code.startsWith('CHECKOUT_');

/**
 * US-30: hace el checkout. Si el back lo rechaza por una regla (saldo, consumos en curso, etc.)
 * devuelve el motivo para que el panel lo muestre; cualquier otro error se propaga.
 */
export const checkoutReservation = async (reservationId: string, force = false): Promise<CheckoutResult> => {
  try {
    const { data } = await apiClient.post<ReservationAccount>(`/reservations/${reservationId}/account/checkout`, {
      force,
    });
    return { ok: true, account: data };
  } catch (error: unknown) {
    const body: unknown = isAxiosError(error) ? error.response?.data : undefined;
    if (isAxiosError(error) && error.response?.status === 409 && isCheckoutBlock(body)) {
      return { ok: false, block: body };
    }
    throw error;
  }
};

const STATEMENT_ERROR = 'No se pudo generar el estado de cuenta.';

/** El error de un pedido con `responseType: 'blob'` llega como Blob: se lee el mensaje del back. */
const readBlobError = async (error: unknown): Promise<string> => {
  if (!isAxiosError(error) || !(error.response?.data instanceof Blob)) return STATEMENT_ERROR;
  try {
    const { message } = JSON.parse(await error.response.data.text()) as { message?: string };
    return message || STATEMENT_ERROR;
  } catch {
    return STATEMENT_ERROR;
  }
};

/** US-30: estado de cuenta en PDF, con el nombre de archivo que propone el back. */
export const fetchAccountStatement = async (reservationId: string): Promise<{ blob: Blob; filename: string }> => {
  try {
    const response = await apiClient.get<Blob>(`/reservations/${reservationId}/account/statement`, {
      responseType: 'blob',
      timeout: 30_000,
    });
    const disposition = String(response.headers['content-disposition'] ?? '');
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'estado-de-cuenta.pdf';
    return { blob: response.data, filename };
  } catch (error: unknown) {
    throw new Error(await readBlobError(error));
  }
};
