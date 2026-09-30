import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getChat,
  listChatMessages,
  markChatAsRead,
  releaseChat,
  sendChatMessage,
  takeOverChat,
} from '@/services/chat.service';
import { useSocket } from '@/context/socket.context';
import { useAuth } from '@/context/auth.context';
import type { ChatDetail, ChatMessage, ChatMessageEvent, ChatStatusEvent } from '@/config/types';

const PAGE_SIZE = 50;

const toChronological = (messages: ChatMessage[]): ChatMessage[] => [...messages].reverse();

const upsertMessage = (messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] =>
  messages.some((message) => message.id === incoming.id)
    ? messages.map((message) => (message.id === incoming.id ? incoming : message))
    : [...messages, incoming];

export function useChatConversation(chatId: string | undefined) {
  const { socket, isConnected, subscribeToChat } = useSocket();
  const { user } = useAuth();

  const [chat, setChat] = useState<ChatDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestedChatId = useRef<string | undefined>(undefined);

  const lastMarkedMessageId = useRef<string | null>(null);

  useEffect(() => {
    requestedChatId.current = chatId;

    if (!chatId) {
      setChat(null);
      setMessages([]);
      setCursor(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setNotice(null);

    const load = async () => {
      try {
        const [detail, page] = await Promise.all([
          getChat(chatId),
          listChatMessages(chatId, { limit: PAGE_SIZE }),
        ]);
        if (requestedChatId.current !== chatId) return;

        setChat(detail);
        setMessages(toChronological(page.data));
        setCursor(page.nextCursor);

        void markChatAsRead(chatId).catch(() => undefined);
      } catch (err) {
        if (requestedChatId.current !== chatId) return;

        setChat(null);
        setMessages([]);
        setCursor(null);
        setError(err instanceof Error ? err.message : 'No se pudo abrir la conversación.');
      } finally {
        if (requestedChatId.current === chatId) setIsLoading(false);
      }
    };

    void load();
  }, [chatId]);

  useEffect(() => {
    if (!chatId || !isConnected) return;

    return subscribeToChat(chatId);
  }, [chatId, isConnected, subscribeToChat]);

  useEffect(() => {
    if (!socket || !chatId) return;

    const handleMessage = (event: ChatMessageEvent) => {
      if (event.chatId !== chatId) return;

      setMessages((prev) => upsertMessage(prev, event.message));
      setChat((prev) => (prev ? { ...prev, status: event.session.status } : prev));

      if (event.message.role === 'USER' && lastMarkedMessageId.current !== event.message.id) {
        lastMarkedMessageId.current = event.message.id;
        void markChatAsRead(chatId).catch(() => undefined);
      }
    };

    const handleStatus = (event: ChatStatusEvent) => {
      if (event.chatId !== chatId) return;

      setChat((prev) => {
        if (!prev) return prev;

        const isPending = event.reason !== null && event.status !== 'HUMAN';

        return {
          ...prev,
          status: event.status,
          assignedOperator: event.assignedOperator,
          handoverRequestedAt: isPending ? event.changedAt : null,
          handoverReason: isPending ? event.reason : null,
        };
      });
    };

    socket.on('chat:message', handleMessage);
    socket.on('chat:status', handleStatus);

    return () => {
      socket.off('chat:message', handleMessage);
      socket.off('chat:status', handleStatus);
    };
  }, [socket, chatId]);

  const loadMore = useCallback(async () => {
    if (!chatId || !cursor || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const page = await listChatMessages(chatId, { before: cursor, limit: PAGE_SIZE });
      if (requestedChatId.current !== chatId) return;

      // Los más viejos van adelante, filtrando por id: un mensaje justo en el borde
      // del cursor puede venir en las dos páginas.
      setMessages((prev) => {
        const known = new Set(prev.map((message) => message.id));
        const older = toChronological(page.data).filter((message) => !known.has(message.id));

        return [...older, ...prev];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los mensajes anteriores.');
    } finally {
      setIsLoadingMore(false);
    }
  }, [chatId, cursor, isLoadingMore]);

  /**
   * CA3. El mensaje se muestra al toque, pero si Telegram lo rechaza el back devuelve 502
   * y no persiste nada: en ese caso se saca de la pantalla y el error sube al compositor.
   */
  const sendMessage = useCallback(
    async (text: string) => {
      if (!chatId) return;

      const optimisticId = `temp-${Date.now()}`;
      const optimistic: ChatMessage = {
        id: optimisticId,
        role: 'OPERATOR',
        content: text,
        sentBy: user ? { id: user.id, fullName: user.fullName } : null,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimistic]);
      setIsSending(true);

      try {
        const saved = await sendChatMessage(chatId, text);

        setMessages((prev) =>
          upsertMessage(
            prev.filter((message) => message.id !== optimisticId),
            saved,
          ),
        );
      } catch (err) {
        setMessages((prev) => prev.filter((message) => message.id !== optimisticId));
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [chatId, user],
  );

  /** CA2: silencia al bot y el back saluda al huésped en nombre del operador. */
  const takeOver = useCallback(async () => {
    if (!chatId) return;

    setIsUpdatingStatus(true);
    try {
      const detail = await takeOverChat(chatId);

      setChat(detail);
      setNotice(
        detail.guestNotified === false
          ? 'Tomaste el control, pero no se pudo avisarle al huésped por Telegram.'
          : null,
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  }, [chatId]);

  /** CA4: devuelve la conversación al bot y le avisa al huésped. */
  const release = useCallback(
    async (closeActiveBooking: boolean) => {
      if (!chatId) return;

      setIsUpdatingStatus(true);
      try {
        const detail = await releaseChat(chatId, closeActiveBooking);

        setChat(detail);
        setNotice(
          detail.guestNotified === false
            ? 'El bot volvió a atender, pero no se pudo avisarle al huésped por Telegram.'
            : null,
        );
      } finally {
        setIsUpdatingStatus(false);
      }
    },
    [chatId],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    chat,
    messages,
    isLoading,
    isLoadingMore,
    isSending,
    isUpdatingStatus,
    error,
    notice,
    hasMore: cursor !== null,
    loadMore,
    sendMessage,
    takeOver,
    release,
    dismissNotice,
  };
}
