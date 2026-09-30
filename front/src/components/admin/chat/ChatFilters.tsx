import type { ChatListFilters } from '@/config/types';

interface ChatFiltersProps {
  filters: ChatListFilters;
  /** Cambia un filtro y resetea a página 1 (lo resuelve el hook). */
  onChange: (patch: Partial<ChatListFilters>) => void;
}

type InboxView = 'ALL' | 'NEEDS_ATTENTION' | 'MINE' | 'HUMAN' | 'BOT';

/**
 * Un solo selector en vez de selector + toggles: cada vista fija los tres filtros a la vez,
 * así ninguno queda activo de una elección anterior. "Requieren atención" usa
 * `pendingHandover` y no el estado WAITING_HUMAN porque también tiene que mostrar los chats
 * que siguen con el bot pero tienen la bandera levantada (fuera de horario o fallback de la IA).
 */
const VIEWS: { value: InboxView; label: string; filters: Pick<ChatListFilters, 'status' | 'pendingHandover' | 'assignedToMe'> }[] = [
  { value: 'ALL', label: 'Todas', filters: { status: 'ALL', pendingHandover: false, assignedToMe: false } },
  { value: 'NEEDS_ATTENTION', label: 'Requieren atención', filters: { status: 'ALL', pendingHandover: true, assignedToMe: false } },
  { value: 'MINE', label: 'Mías', filters: { status: 'ALL', pendingHandover: false, assignedToMe: true } },
  { value: 'HUMAN', label: 'Atendidas por un humano', filters: { status: 'HUMAN', pendingHandover: false, assignedToMe: false } },
  { value: 'BOT', label: 'Con el bot', filters: { status: 'BOT', pendingHandover: false, assignedToMe: false } },
];

const currentView = (filters: ChatListFilters): InboxView => {
  if (filters.pendingHandover) return 'NEEDS_ATTENTION';
  if (filters.assignedToMe) return 'MINE';
  if (filters.status === 'HUMAN' || filters.status === 'BOT') return filters.status;
  return 'ALL';
};

const inputClasses =
  'w-full rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

/** Búsqueda y filtros de la bandeja de conversaciones. */
export default function ChatFilters({ filters, onChange }: ChatFiltersProps) {
  return (
    <div className="space-y-3 border-b border-goldLight/10 p-4">
      <input
        type="search"
        value={filters.search ?? ''}
        // El back corta la búsqueda en 60 caracteres: se limita acá para no comerse un 400.
        maxLength={60}
        onChange={(event) => onChange({ search: event.target.value })}
        placeholder="Buscar por nombre, usuario o ID de Telegram"
        className={inputClasses}
        aria-label="Buscar conversaciones"
      />

      <select
        value={currentView(filters)}
        onChange={(event) => {
          const view = VIEWS.find((option) => option.value === event.target.value);
          if (view) onChange(view.filters);
        }}
        className={inputClasses}
        aria-label="Qué conversaciones mostrar"
      >
        {VIEWS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
