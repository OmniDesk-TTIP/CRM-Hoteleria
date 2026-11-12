import { isAxiosError } from 'axios';
import apiClient from '@/config/api';

export type MenuPdfKind = 'restaurant' | 'room-service' | 'spa';

const FALLBACK_ERROR = 'No se pudo generar el PDF.';

/** Con `responseType: 'blob'` el error del back también llega como Blob: hay que leerlo aparte. */
const readErrorMessage = async (err: unknown): Promise<string> => {
  if (!isAxiosError(err) || !(err.response?.data instanceof Blob)) return FALLBACK_ERROR;

  try {
    const { message } = JSON.parse(await err.response.data.text()) as { message?: string };
    return message || FALLBACK_ERROR;
  } catch {
    return FALLBACK_ERROR;
  }
};

/** US-25 CA8: el PDF tal cual lo recibe el huésped, generado con lo cargado en el panel. */
export const fetchMenuPdf = async (kind: MenuPdfKind): Promise<Blob> => {
  try {
    const { data } = await apiClient.get<Blob>(`/menu-pdfs/${kind}`, { responseType: 'blob', timeout: 30_000 });
    return data;
  } catch (err: unknown) {
    throw new Error(await readErrorMessage(err));
  }
};
