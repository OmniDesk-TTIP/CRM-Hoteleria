import apiClient from '@/config/api';
import type { Campaign, CampaignAudience, CampaignFormData, PaginatedResult } from '@/config/types';

export const listCampaigns = async (page: number, pageSize: number): Promise<PaginatedResult<Campaign>> => {
  const { data } = await apiClient.get<PaginatedResult<Campaign>>('/campaigns', { params: { page, pageSize } });
  return data;
};

export const countCampaignRecipients = async (audience: CampaignAudience): Promise<number> => {
  const { data } = await apiClient.get<{ audience: CampaignAudience; count: number }>('/campaigns/recipients-count', {
    params: { audience },
  });
  return data.count;
};

/** El back responde enseguida (202) y sigue mandando en segundo plano. */
export const createCampaign = async (payload: CampaignFormData): Promise<Campaign> => {
  const form = new FormData();
  form.append('title', payload.title);
  form.append('message', payload.message);
  form.append('audience', payload.audience);
  if (payload.image) form.append('image', payload.image);

  const { data } = await apiClient.post<Campaign>('/campaigns', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
};
