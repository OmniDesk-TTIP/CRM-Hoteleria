import apiClient from '@/config/api';
import type { SpaService, SpaServiceFormData } from '@/config/types';

export const listSpaServices = async (): Promise<SpaService[]> => {
  const { data } = await apiClient.get<SpaService[]>('/spa-services');
  return data;
};

export const createSpaService = async (payload: SpaServiceFormData): Promise<SpaService> => {
  const { data } = await apiClient.post<SpaService>('/spa-services', payload);
  return data;
};

export const updateSpaService = async (
  id: string,
  payload: Partial<SpaServiceFormData>,
): Promise<SpaService> => {
  const { data } = await apiClient.patch<SpaService>(`/spa-services/${id}`, payload);
  return data;
};

export const deactivateSpaService = async (id: string): Promise<void> => {
  await apiClient.delete(`/spa-services/${id}`);
};
