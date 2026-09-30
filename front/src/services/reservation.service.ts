import apiClient from '@/config/api';
import type {
  AdminReservation,
  PaginatedResult,
  ReservationFormData,
  ReservationListFilters,
} from '@/config/types';

/**
 * Arma los query params para `GET /reservations`, omitiendo los filtros que
 * no aplican (status "ALL" o rango de fechas vacío) para no mandar basura al back.
 */
const buildListParams = (filters: ReservationListFilters) => {
  const params: Record<string, string | number> = {
    page: filters.page,
    pageSize: filters.pageSize,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
  };

  if (filters.status && filters.status !== 'ALL') params.status = filters.status;
  if (filters.dateFrom) params.dateFrom = filters.dateFrom;
  if (filters.dateTo) params.dateTo = filters.dateTo;

  return params;
};

export const listReservations = async (
  filters: ReservationListFilters,
): Promise<PaginatedResult<AdminReservation>> => {
  const { data } = await apiClient.get<PaginatedResult<AdminReservation>>('/reservations', {
    params: buildListParams(filters),
  });
  return data;
};

export const createReservation = async (payload: ReservationFormData): Promise<AdminReservation> => {
  const { data } = await apiClient.post<AdminReservation>('/reservations', payload);
  return data;
};

export const updateReservation = async (
  id: string,
  payload: ReservationFormData,
): Promise<AdminReservation> => {
  const { data } = await apiClient.patch<AdminReservation>(`/reservations/${id}`, payload);
  return data;
};

/**
 * Cancela/elimina la reserva (soft delete en el back: la habitación queda liberada
 * de inmediato, CA5). Se pide confirmación doble antes de llamar a esto, ver
 * `ConfirmCancelModal`.
 */
export const cancelReservation = async (id: string): Promise<void> => {
  await apiClient.delete(`/reservations/${id}`);
};
