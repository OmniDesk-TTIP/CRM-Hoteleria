import apiClient from '@/config/api';
import type { SupportHours, SupportHoursDay } from '@/config/types';

/** CA5: horario de la recepción. Cualquier usuario autenticado puede leerlo. */
export const getSupportHours = async (): Promise<SupportHours> => {
  const { data } = await apiClient.get<SupportHours>('/support-hours');
  return data;
};

/**
 * Reemplaza la semana entera: es un PUT, no un PATCH por día, y el back exige
 * exactamente los 7 días. Solo ADMIN.
 */
export const updateSupportHours = async (days: SupportHoursDay[]): Promise<SupportHours> => {
  const { data } = await apiClient.put<SupportHours>('/support-hours', { days });
  return data;
};
