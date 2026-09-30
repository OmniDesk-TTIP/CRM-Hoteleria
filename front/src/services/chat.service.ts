import apiClient from '@/config/api';
import type {
  ChatDetail,
  ChatListFilters,
  ChatMessage,
  ChatSummary,
  CursorPage,
  PaginatedResult,
} from '@/config/types';

/**
 * Arma los query params de `GET /chats`. El ValidationPipe del back usa
 * `forbidNonWhitelisted`, así que un filtro vacío o un `status: 'ALL'` no se
 * mandan: irían como campo de más y devolverían 400 en vez de ignorarse.
 */
const buildListParams = (filters: ChatListFilters) => {
  const params: Record<string, string | number | boolean> = {
    page: filters.page,
    pageSize: filters.pageSize,
    sortDir: filters.sortDir,
  };

  if (filters.status && filters.status !== 'ALL') params.status = filters.status;
  if (filters.pendingHandover) params.pendingHandover = true;
  if (filters.assignedToMe) params.assignedToMe = true;

  const search = filters.search?.trim();
  if (search) params.search = search;

  return params;
};

export const listChats = async (filters: ChatListFilters): Promise<PaginatedResult<ChatSummary>> => {
  const { data } = await apiClient.get<PaginatedResult<ChatSummary>>('/chats', {
    params: buildListParams(filters),
  });
  return data;
};

export const getChat = async (chatId: string): Promise<ChatDetail> => {
  const { data } = await apiClient.get<ChatDetail>(`/chats/${chatId}`);
  return data;
};

/**
 * Historial de la conversación (CA3). Viene del más nuevo al más viejo; `before` es el
 * `createdAt` del mensaje más viejo que el panel ya tiene (el `nextCursor` de la página anterior).
 */
export const listChatMessages = async (
  chatId: string,
  options: { before?: string; limit?: number } = {},
): Promise<CursorPage<ChatMessage>> => {
  const params: Record<string, string | number> = { limit: options.limit ?? 50 };
  if (options.before) params.before = options.before;

  const { data } = await apiClient.get<CursorPage<ChatMessage>>(`/chats/${chatId}/messages`, { params });
  return data;
};

/**
 * Manda el mensaje al Telegram del huésped (CA3). Solo con el control tomado: si el chat
 * está en BOT o WAITING_HUMAN el back responde 409. Si Telegram rechaza el envío responde
 * 502 y no persiste nada.
 */
export const sendChatMessage = async (chatId: string, text: string): Promise<ChatMessage> => {
  const { data } = await apiClient.post<ChatMessage>(`/chats/${chatId}/messages`, { text });
  return data;
};

/**
 * CA2: silencia al bot, asigna la conversación y saluda al huésped en nombre del operador.
 * `guestNotified: false` significa que el control se tomó pero el saludo no llegó a Telegram.
 */
export const takeOverChat = async (chatId: string): Promise<ChatDetail> => {
  const { data } = await apiClient.post<ChatDetail>(`/chats/${chatId}/takeover`);
  return data;
};

/**
 * CA4: reactiva a Chamber y le avisa al huésped. `guestNotified: false` en la respuesta
 * significa que el bot volvió igual pero el aviso no llegó a Telegram.
 */
export const releaseChat = async (chatId: string, closeActiveBooking = false): Promise<ChatDetail> => {
  const { data } = await apiClient.post<ChatDetail>(`/chats/${chatId}/release`, { closeActiveBooking });
  return data;
};

export const markChatAsRead = async (chatId: string): Promise<{ unreadCount: number }> => {
  const { data } = await apiClient.post<{ unreadCount: number }>(`/chats/${chatId}/read`);
  return data;
};
