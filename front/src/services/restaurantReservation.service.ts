import apiClient from '@/config/api';
import type {
  PaginatedRestaurantReservations,
  RestaurantReservation,
  RestaurantReservationListFilters,
} from '@/config/types';

const buildListParams = ({ status, page, pageSize }: RestaurantReservationListFilters) => ({
  page,
  pageSize,
  ...(status !== 'ALL' ? { status } : {}),
});

export const listRestaurantReservations = async (
  filters: RestaurantReservationListFilters,
): Promise<PaginatedRestaurantReservations> => {
  const { data } = await apiClient.get<PaginatedRestaurantReservations>('/restaurant-reservations', {
    params: buildListParams(filters),
  });
  return data;
};

export const changeRestaurantReservationStatus = async (
  id: string,
  status: 'CONFIRMED' | 'REJECTED',
): Promise<RestaurantReservation> => {
  const { data } = await apiClient.patch<RestaurantReservation>(`/restaurant-reservations/${id}/status`, {
    status,
  });
  return data;
};
