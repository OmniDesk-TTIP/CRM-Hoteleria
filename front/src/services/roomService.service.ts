import apiClient from '@/config/api';
import type {
  PaginatedRoomServiceOrders,
  RoomServiceOrder,
  RoomServiceOrderListFilters,
  RoomServiceOrderStatus,
} from '@/config/types';

const buildListParams = ({ status, page, pageSize }: RoomServiceOrderListFilters) => ({
  page,
  pageSize,
  ...(status !== 'ALL' ? { status } : {}),
});

export const listRoomServiceOrders = async (
  filters: RoomServiceOrderListFilters,
): Promise<PaginatedRoomServiceOrders> => {
  const { data } = await apiClient.get<PaginatedRoomServiceOrders>('/room-service-orders', {
    params: buildListParams(filters),
  });
  return data;
};

export const changeRoomServiceOrderStatus = async (
  id: string,
  status: Exclude<RoomServiceOrderStatus, 'RECEIVED'>,
): Promise<RoomServiceOrder> => {
  const { data } = await apiClient.patch<RoomServiceOrder>(`/room-service-orders/${id}/status`, { status });
  return data;
};
