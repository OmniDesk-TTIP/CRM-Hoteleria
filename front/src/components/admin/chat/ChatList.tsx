import ChatListItem from '@/components/admin/chat/ChatListItem';
import ChatFilters from '@/components/admin/chat/ChatFilters';
import Pagination from '@/components/admin/Pagination';
import type { ChatListFilters, ChatSummary } from '@/config/types';

const CHAT_LABEL = { singular: 'conversación', plural: 'conversaciones' };

interface ChatListProps {
  chats: ChatSummary[];
  total: number;
  filters: ChatListFilters;
  isLoading: boolean;
  error: string | null;
  selectedChatId?: string;
  onFiltersChange: (patch: Partial<ChatListFilters>) => void;
  onPageChange: (page: number) => void;
  onSelect: (chatId: string) => void;
}

/** Bandeja: filtros arriba, conversaciones al medio y paginación abajo. */
export default function ChatList({
  chats,
  total,
  filters,
  isLoading,
  error,
  selectedChatId,
  onFiltersChange,
  onPageChange,
  onSelect,
}: ChatListProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-goldLight/15 bg-card">
      <ChatFilters filters={filters} onChange={onFiltersChange} />

      <div className="flex-1 overflow-y-auto">
        {error && <p className="p-4 text-sm text-dangerText">⚠ {error}</p>}

        {!error && isLoading && chats.length === 0 && (
          <p className="p-4 text-sm text-textMuted">Cargando conversaciones…</p>
        )}

        {!error && !isLoading && chats.length === 0 && (
          <p className="p-4 text-sm text-textMuted">No hay conversaciones que coincidan con el filtro.</p>
        )}

        {chats.map((chat) => (
          <ChatListItem
            key={chat.id}
            chat={chat}
            isActive={chat.id === selectedChatId}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Sin resultados ya lo dice el mensaje de la lista: el pie solo aparece si hay algo que contar. */}
      {total > 0 && (
        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          onPageChange={onPageChange}
          itemLabel={CHAT_LABEL}
        />
      )}
    </div>
  );
}
