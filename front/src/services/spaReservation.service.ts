import apiClient from '@/config/api';
import type {
  PaginatedSpaReservations,
  SpaReservation,
  SpaReservationListFilters,
} from '@/config/types';

/** El back usa `forbidNonWhitelisted`: los filtros vacíos o 'ALL' no se mandan. */
const buildListParams = ({ status, page, pageSize }: SpaReservationListFilters) => ({
  page,
  pageSize,
  ...(status !== 'ALL' ? { status } : {}),
});

export const listSpaReservations = async (
  filters: SpaReservationListFilters,
): Promise<PaginatedSpaReservations> => {
  const { data } = await apiClient.get<PaginatedSpaReservations>('/spa-reservations', {
    params: buildListParams(filters),
  });
  return data;
};

export const changeSpaReservationStatus = async (
  id: string,
  status: 'CONFIRMED' | 'REJECTED',
): Promise<SpaReservation> => {
  const { data } = await apiClient.patch<SpaReservation>(`/spa-reservations/${id}/status`, { status });
  return data;
};
