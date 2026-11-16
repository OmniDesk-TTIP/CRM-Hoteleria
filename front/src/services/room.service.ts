import apiClient from '@/config/api';
import type { RoomFormData, RoomOption, RoomPhoto } from '@/config/types';

export const listRoomOptions = async (): Promise<RoomOption[]> => {
  const { data } = await apiClient.get<RoomOption[]>('/rooms');
  return data;
};

export const createRoom = async (payload: RoomFormData): Promise<RoomOption> => {
  const { data } = await apiClient.post<RoomOption>('/rooms', payload);
  return data;
};

export const updateRoom = async (id: string, payload: Partial<RoomFormData>): Promise<RoomOption> => {
  const { data } = await apiClient.patch<RoomOption>(`/rooms/${id}`, payload);
  return data;
};

export const deactivateRoom = async (id: string): Promise<void> => {
  await apiClient.delete(`/rooms/${id}`);
};

// ───────── Galería por tipo de habitación ─────────

const photosPath = (categoryId: string) => `/rooms/categories/${categoryId}/photos`;

export const listRoomPhotos = async (categoryId: string): Promise<RoomPhoto[]> => {
  const { data } = await apiClient.get<RoomPhoto[]>(photosPath(categoryId));
  return data;
};

export const uploadRoomPhoto = async (categoryId: string, file: File): Promise<RoomPhoto> => {
  const form = new FormData();
  form.append('file', file);

  const { data } = await apiClient.post<RoomPhoto>(photosPath(categoryId), form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
};

export const reorderRoomPhotos = async (categoryId: string, ids: string[]): Promise<RoomPhoto[]> => {
  const { data } = await apiClient.put<RoomPhoto[]>(`${photosPath(categoryId)}/order`, { ids });
  return data;
};

export const deleteRoomPhoto = async (categoryId: string, id: string): Promise<void> => {
  await apiClient.delete(`${photosPath(categoryId)}/${id}`);
};
