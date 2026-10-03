import apiClient from '@/config/api';
import type { BotStatistics, StatisticsRange } from '@/config/types';

export const getStatistics = async (range: StatisticsRange): Promise<BotStatistics> => {
  const { data } = await apiClient.get<BotStatistics>('/statistics', { params: { range } });
  return data;
};
