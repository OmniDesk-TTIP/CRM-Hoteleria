import type { ReservationListFilters, ReservationStatus } from '@/config/types';

interface ReservationFiltersProps {
  filters: ReservationListFilters;
  /** Cambia un filtro y resetea a página 1 (lo resuelve el padre). */
  onChange: (patch: Partial<ReservationListFilters>) => void;
}

const STATUS_OPTIONS: { value: ReservationStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'Todos los estados' },
  { value: 'PENDING_PAYMENT', label: 'Pendiente' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'CANCELLED', label: 'Cancelada' },
];

const inputClasses =
  'w-full min-w-0 rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 sm:w-auto';

export default function ReservationFilters({ filters, onChange }: ReservationFiltersProps) {
  const hasDateRange = Boolean(filters.dateFrom || filters.dateTo);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-goldLight/15 bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <label className="flex flex-col gap-1 text-xs text-textMuted">
        Estado
        <select
          value={filters.status ?? 'ALL'}
          onChange={(event) =>
            onChange({ status: event.target.value as ReservationStatus | 'ALL' })
          }
          className={inputClasses}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-textMuted">
        Desde
        <input
          type="date"
          value={filters.dateFrom ?? ''}
          onChange={(event) => onChange({ dateFrom: event.target.value || undefined })}
          className={inputClasses}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-textMuted">
        Hasta
        <input
          type="date"
          value={filters.dateTo ?? ''}
          onChange={(event) => onChange({ dateTo: event.target.value || undefined })}
          className={inputClasses}
        />
      </label>

      {hasDateRange && (
        <button
          type="button"
          onClick={() => onChange({ dateFrom: undefined, dateTo: undefined })}
          className="self-start rounded-full px-3 py-2 text-xs font-medium text-textMuted underline underline-offset-4 transition hover:text-goldLight motion-reduce:transition-none"
        >
          Limpiar fechas
        </button>
      )}
    </div>
  );
}
