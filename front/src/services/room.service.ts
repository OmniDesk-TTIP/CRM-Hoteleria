import apiClient from '@/config/api';
import type { RoomFormData, RoomOption } from '@/config/types';

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
