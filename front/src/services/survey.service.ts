import apiClient from '@/config/api';
import type { PaginatedSurveyResponses, SurveyPeriod, SurveyResponse, SurveySummary } from '@/config/types';

/** El back usa `forbidNonWhitelisted`: los límites vacíos no se mandan. */
const periodParams = ({ from, to }: SurveyPeriod) => ({
  ...(from ? { from } : {}),
  ...(to ? { to } : {}),
});

export const listSurveyResponses = async (
  period: SurveyPeriod,
  page: number,
  pageSize: number,
): Promise<PaginatedSurveyResponses> => {
  const { data } = await apiClient.get<PaginatedSurveyResponses>('/surveys', {
    params: { ...periodParams(period), page, pageSize },
  });
  return data;
};

export const getSurveySummary = async (period: SurveyPeriod): Promise<SurveySummary> => {
  const { data } = await apiClient.get<SurveySummary>('/surveys/summary', { params: periodParams(period) });
  return data;
};

/** Publica u oculta la reseña en la web del hotel. Solo se publica con el consentimiento del huésped. */
export const setSurveyPublication = async (id: string, published: boolean): Promise<SurveyResponse> => {
  const { data } = await apiClient.patch<SurveyResponse>(`/surveys/${id}/publication`, { published });
  return data;
};
