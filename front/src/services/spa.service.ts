import apiClient from '@/config/api';
import type { SpaPhoto, SpaService, SpaServiceFormData } from '@/config/types';

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

// ───────── Galería ─────────

export const listSpaPhotos = async (): Promise<SpaPhoto[]> => {
  const { data } = await apiClient.get<SpaPhoto[]>('/spa/photos');
  return data;
};

export const uploadSpaPhoto = async (file: File): Promise<SpaPhoto> => {
  const form = new FormData();
  form.append('file', file);

  const { data } = await apiClient.post<SpaPhoto>('/spa/photos', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
};

export const reorderSpaPhotos = async (ids: string[]): Promise<SpaPhoto[]> => {
  const { data } = await apiClient.put<SpaPhoto[]>('/spa/photos/order', { ids });
  return data;
};

export const deleteSpaPhoto = async (id: string): Promise<void> => {
  await apiClient.delete(`/spa/photos/${id}`);
};
