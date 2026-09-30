import { useCallback, useEffect, useState } from 'react';
import { listChats } from '@/services/chat.service';
import { useSocket } from '@/context/socket.context';
import { useAuth } from '@/context/auth.context';
import type {
  ChatCreatedEvent,
  ChatListFilters,
  ChatMessageEvent,
  ChatReadEvent,
  ChatStatusEvent,
  ChatSummary,
} from '@/config/types';

export const DEFAULT_CHAT_FILTERS: ChatListFilters = {
  page: 1,
  pageSize: 20,
  sortDir: 'desc',
  status: 'ALL',
};

const matchesFilters = (chat: ChatSummary, filters: ChatListFilters, operatorId?: string): boolean => {
  if (filters.status && filters.status !== 'ALL' && chat.status !== filters.status) return false;
  if (filters.pendingHandover && !chat.handoverRequestedAt) return false;
  if (filters.assignedToMe && chat.assignedOperator?.id !== operatorId) return false;

  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const haystack = [chat.telegramUserId, chat.guestDisplayName, chat.telegramUsername]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(search)) return false;
  }

  return true;
};

const sortChats = (chats: ChatSummary[], sortDir: ChatListFilters['sortDir']): ChatSummary[] =>
  [...chats].sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;

    const diff = new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    return sortDir === 'asc' ? -diff : diff;
  });


export function useChatInbox(initialFilters?: Partial<ChatListFilters>) {
  const { socket } = useSocket();
  const { user } = useAuth();

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ChatListFilters>(() => ({
    ...DEFAULT_CHAT_FILTERS,
    ...initialFilters,
  }));

  const fetchChats = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listChats(filters);
      setChats(sortChats(result.data, filters.sortDir));
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las conversaciones.');
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (!socket) return;

    const operatorId = user?.id;

    const handleCreated = ({ chat }: ChatCreatedEvent) => {
      if (filters.page !== 1 || !matchesFilters(chat, filters, operatorId)) return;

      setChats((prev) => (prev.some((c) => c.id === chat.id) ? prev : sortChats([chat, ...prev], filters.sortDir)));
      setTotal((prev) => prev + 1);
    };

    const handleMessage = ({ chatId, session }: ChatMessageEvent) => {
      setChats((prev) => {
        const next = prev.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                status: session.status,
                unreadCount: session.unreadCount,
                lastMessageAt: session.lastMessageAt,
                lastMessagePreview: session.lastMessagePreview,
              }
            : chat,
        );

        return sortChats(
          next.filter((chat) => matchesFilters(chat, filters, operatorId)),
          filters.sortDir,
        );
      });
    };

    const handleStatus = (event: ChatStatusEvent) => {
      setChats((prev) => {
        const next = prev.map((chat) => {
          if (chat.id !== event.chatId) return chat;
          const isPending = event.reason !== null && event.status !== 'HUMAN';

          return {
            ...chat,
            status: event.status,
            assignedOperator: event.assignedOperator,
            handoverRequestedAt: isPending ? event.changedAt : null,
            handoverReason: isPending ? event.reason : null,
          };
        });

        return sortChats(
          next.filter((chat) => matchesFilters(chat, filters, operatorId)),
          filters.sortDir,
        );
      });
    };

    const handleRead = ({ chatId, unreadCount }: ChatReadEvent) => {
      setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, unreadCount } : chat)));
    };

    socket.on('chat:created', handleCreated);
    socket.on('chat:message', handleMessage);
    socket.on('chat:status', handleStatus);
    socket.on('chat:read', handleRead);

    return () => {
      socket.off('chat:created', handleCreated);
      socket.off('chat:message', handleMessage);
      socket.off('chat:status', handleStatus);
      socket.off('chat:read', handleRead);
    };
  }, [socket, filters, user?.id]);

  const changeFilters = useCallback((patch: Partial<ChatListFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch, page: 1 }));
  }, []);

  const goToPage = useCallback((page: number) => {
    setFilters((prev) => ({ ...prev, page }));
  }, []);

  return { chats, total, isLoading, error, filters, changeFilters, goToPage, refresh: fetchChats };
}
