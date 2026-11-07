import apiClient from '@/config/api';
import type { PaginatedResult, Promotion, PromotionFormData, PromotionListFilters } from '@/config/types';

export const listPromotions = async ({
  status,
  page,
  pageSize,
}: PromotionListFilters): Promise<PaginatedResult<Promotion>> => {
  const { data } = await apiClient.get<PaginatedResult<Promotion>>('/promotions', {
    params: { page, pageSize, ...(status === 'ALL' ? {} : { status }) },
  });
  return data;
};

export const createPromotion = async (payload: PromotionFormData): Promise<Promotion> => {
  const { data } = await apiClient.post<Promotion>('/promotions', payload);
  return data;
};

export const updatePromotion = async (id: string, payload: PromotionFormData): Promise<Promotion> => {
  const { data } = await apiClient.patch<Promotion>(`/promotions/${id}`, payload);
  return data;
};

export const setPromotionEnabled = async (id: string, enabled: boolean): Promise<Promotion> => {
  const { data } = await apiClient.patch<Promotion>(`/promotions/${id}/enabled`, { enabled });
  return data;
};

export const deletePromotion = async (id: string): Promise<void> => {
  await apiClient.delete(`/promotions/${id}`);
};
