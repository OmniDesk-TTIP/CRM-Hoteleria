import apiClient from '@/config/api';
import type { DashboardStatus, DashboardSummary } from '@/config/types';

export const getDashboardSummary = async (): Promise<DashboardSummary> => {
  const { data } = await apiClient.get<DashboardSummary>('/dashboard/summary');
  return data;
};

export const getDashboardStatus = async (): Promise<DashboardStatus> => {
  const { data } = await apiClient.get<DashboardStatus>('/dashboard/status');
  return data;
};
