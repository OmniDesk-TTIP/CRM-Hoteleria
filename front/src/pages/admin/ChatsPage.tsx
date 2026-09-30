import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ChatList from '@/components/admin/chat/ChatList';
import ChatWindow from '@/components/admin/chat/ChatWindow';
import { useChatInbox } from '@/hooks/useChatInbox';
import { useChatConversation } from '@/hooks/useChatConversation';
import { useSocket } from '@/context/socket.context';

export default function ChatsPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { isConnected } = useSocket();

  const [searchParams] = useSearchParams();
  const { chats, total, isLoading, error, filters, changeFilters, goToPage } = useChatInbox({
    pendingHandover: searchParams.get('pendingHandover') === 'true' || undefined,
    assignedToMe: searchParams.get('assignedToMe') === 'true' || undefined,
  });
  const conversation = useChatConversation(chatId);

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-text">Conversaciones</h1>
        <p className="flex items-center gap-2 text-xs text-textMuted">
          <span
            className={`h-2 w-2 rounded-full ${isConnected ? 'bg-success' : 'bg-danger'}`}
            aria-hidden
          />
          {isConnected ? 'Actualizándose en vivo' : 'Sin conexión en vivo'}
        </p>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">

        <div className={`min-h-0 ${chatId ? 'hidden lg:block' : ''}`}>
          <ChatList
            chats={chats}
            total={total}
            filters={filters}
            isLoading={isLoading}
            error={error}
            selectedChatId={chatId}
            onFiltersChange={changeFilters}
            onPageChange={goToPage}
            onSelect={(id) => navigate(`/admin/chats/${id}`)}
          />
        </div>

        <div className={`min-h-0 ${chatId ? '' : 'hidden lg:block'}`}>
          <ChatWindow
            chat={conversation.chat}
            messages={conversation.messages}
            isLoading={conversation.isLoading}
            isLoadingMore={conversation.isLoadingMore}
            isSending={conversation.isSending}
            isUpdatingStatus={conversation.isUpdatingStatus}
            error={conversation.error}
            notice={conversation.notice}
            hasMore={conversation.hasMore}
            onLoadMore={conversation.loadMore}
            onSend={conversation.sendMessage}
            onTakeOver={conversation.takeOver}
            onRelease={conversation.release}
            onDismissNotice={conversation.dismissNotice}
            onBack={() => navigate('/admin/chats')}
          />
        </div>
      </div>
    </div>
  );
}
