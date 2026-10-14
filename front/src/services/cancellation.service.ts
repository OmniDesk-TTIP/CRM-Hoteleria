import apiClient from '@/config/api';
import type {
  CancellationPolicy,
  CancellationPolicyFormData,
  PaginatedResult,
  Refund,
  RefundListFilters,
} from '@/config/types';

export const listCancellationPolicies = async (): Promise<CancellationPolicy[]> => {
  const { data } = await apiClient.get<CancellationPolicy[]>('/cancellation-policies');
  return data;
};

export const createCancellationPolicy = async (
  payload: CancellationPolicyFormData,
): Promise<CancellationPolicy> => {
  const { data } = await apiClient.post<CancellationPolicy>('/cancellation-policies', payload);
  return data;
};

export const updateCancellationPolicy = async (
  id: string,
  payload: Partial<CancellationPolicyFormData>,
): Promise<CancellationPolicy> => {
  const { data } = await apiClient.patch<CancellationPolicy>(`/cancellation-policies/${id}`, payload);
  return data;
};

export const activateCancellationPolicy = async (id: string): Promise<CancellationPolicy> => {
  const { data } = await apiClient.post<CancellationPolicy>(`/cancellation-policies/${id}/activate`);
  return data;
};

export const listRefunds = async (filters: RefundListFilters): Promise<PaginatedResult<Refund>> => {
  const params: Record<string, string | number> = { page: filters.page, pageSize: filters.pageSize };
  if (filters.status !== 'ALL') params.status = filters.status;

  const { data } = await apiClient.get<PaginatedResult<Refund>>('/refunds', { params });
  return data;
};

export const completeRefund = async (reservationId: string, refundedAt?: string): Promise<Refund> => {
  const { data } = await apiClient.patch<Refund>(`/refunds/${reservationId}/complete`, {
    ...(refundedAt ? { refundedAt } : {}),
  });
  return data;
};