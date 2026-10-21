import apiClient, { API_BASE_URL } from '@/config/api';
import type {
  MenuItem,
  MenuItemFormData,
  RestaurantPhoto,
  RestaurantSettings,
  RestaurantSettingsFormData,
} from '@/config/types';

export const getRestaurantSettings = async (): Promise<RestaurantSettings> => {
  const { data } = await apiClient.get<RestaurantSettings>('/restaurant');
  return data;
};

export const updateRestaurantSettings = async (
  payload: RestaurantSettingsFormData,
): Promise<RestaurantSettings> => {
  const { data } = await apiClient.put<RestaurantSettings>('/restaurant', payload);
  return data;
};

/* ───────── Carta ───────── */

export const listMenuItems = async (): Promise<MenuItem[]> => {
  const { data } = await apiClient.get<MenuItem[]>('/restaurant/menu-items');
  return data;
};

export const createMenuItem = async (payload: MenuItemFormData): Promise<MenuItem> => {
  const { data } = await apiClient.post<MenuItem>('/restaurant/menu-items', payload);
  return data;
};

export const updateMenuItem = async (id: string, payload: Partial<MenuItemFormData>): Promise<MenuItem> => {
  const { data } = await apiClient.patch<MenuItem>(`/restaurant/menu-items/${id}`, payload);
  return data;
};

export const deleteMenuItem = async (id: string): Promise<void> => {
  await apiClient.delete(`/restaurant/menu-items/${id}`);
};

/* ───────── Galería ───────── */

export const listRestaurantPhotos = async (): Promise<RestaurantPhoto[]> => {
  const { data } = await apiClient.get<RestaurantPhoto[]>('/restaurant/photos');
  return data;
};

export const uploadRestaurantPhoto = async (file: File): Promise<RestaurantPhoto> => {
  const form = new FormData();
  form.append('file', file);

  const { data } = await apiClient.post<RestaurantPhoto>('/restaurant/photos', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
};

export const reorderRestaurantPhotos = async (ids: string[]): Promise<RestaurantPhoto[]> => {
  const { data } = await apiClient.put<RestaurantPhoto[]>('/restaurant/photos/order', { ids });
  return data;
};

export const deleteRestaurantPhoto = async (id: string): Promise<void> => {
  await apiClient.delete(`/restaurant/photos/${id}`);
};

/** La imagen se sirve en una ruta pública del back: un `<img>` la carga sin token. */
export const photoSrc = (photo: RestaurantPhoto): string => `${API_BASE_URL}${photo.url}`;
