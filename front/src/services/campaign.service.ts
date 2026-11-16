import apiClient from '@/config/api';
import type {
  Campaign,
  CampaignAudience,
  CampaignFormData,
  CampaignRecipientFilter,
  PaginatedResult,
} from '@/config/types';

/** Solo los filtros elegidos: los que quedan en null no viajan. */
const filterEntries = (filter: CampaignRecipientFilter): [string, string][] =>
  (
    [
      ['audience', filter.audience],
      ['stayFilter', filter.stayFilter],
      ['stayFrom', filter.stayFrom],
      ['stayTo', filter.stayTo],
      ['minGuests', filter.minGuests],
      ['maxGuests', filter.maxGuests],
    ] as const
  ).flatMap(([key, value]) => (value === null || value === '' ? [] : [[key, String(value)]]));

export const listCampaigns = async (page: number, pageSize: number): Promise<PaginatedResult<Campaign>> => {
  const { data } = await apiClient.get<PaginatedResult<Campaign>>('/campaigns', { params: { page, pageSize } });
  return data;
};

export const countCampaignRecipients = async (filter: CampaignRecipientFilter): Promise<number> => {
  const { data } = await apiClient.get<{ audience: CampaignAudience; count: number }>('/campaigns/recipients-count', {
    params: Object.fromEntries(filterEntries(filter)),
  });
  return data.count;
};

/** El back responde enseguida (202) y sigue mandando en segundo plano. */
export const createCampaign = async ({ title, message, image, ...filter }: CampaignFormData): Promise<Campaign> => {
  const form = new FormData();
  form.append('title', title);
  form.append('message', message);
  for (const [key, value] of filterEntries(filter)) form.append(key, value);
  if (image) form.append('image', image);

  const { data } = await apiClient.post<Campaign>('/campaigns', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60_000,
  });
  return data;
};
