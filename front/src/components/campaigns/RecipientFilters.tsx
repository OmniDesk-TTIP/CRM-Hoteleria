import type { CampaignAudience, CampaignRecipientFilter, CampaignStayFilter } from '@/config/types';
import { AUDIENCE_OPTIONS, MAX_GUESTS_FILTER, pluralizeContacts, STAY_OPTIONS, stayOption } from './campaignFormat';

interface RecipientFiltersProps {
  filter: CampaignRecipientFilter;
  onChange: (patch: Partial<CampaignRecipientFilter>) => void;
  /** null mientras se cuenta. */
  recipients: number | null;
  /** Error de validación local o del conteo; si hay, no se muestra la cantidad. */
  error: string | null;
}

const inputClasses =
  'w-full min-w-0 rounded-xl border border-goldLight/20 bg-surface px-3 py-2 text-sm text-text placeholder:text-textMuted focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

const toGuests = (value: string): number | null => (value === '' ? null : Number(value));

/** Destinatarios base (US-13) + filtro por estadía, fechas y cantidad de personas (CA1–CA3). */
export default function RecipientFilters({ filter, onChange, recipients, error }: RecipientFiltersProps) {
  const selectedAudience = AUDIENCE_OPTIONS.find((option) => option.value === filter.audience);
  const selectedStay = stayOption(filter.stayFilter);
  const hasGuests = filter.minGuests !== null || filter.maxGuests !== null;

  const changeStay = (value: string) => {
    const next = (value || null) as CampaignStayFilter | null;
    // Las fechas no aplican a todos los estados: al cambiar se limpian para no filtrar con un rango oculto.
    onChange({ stayFilter: next, stayFrom: null, stayTo: null });
  };

  return (
    <fieldset className="space-y-3 rounded-xl border border-goldLight/15 p-3">
      <legend className="px-1 text-sm text-textMuted">Destinatarios *</legend>

      <label className="flex flex-col gap-1 text-sm text-textMuted">
        Contactos
        <select
          value={filter.audience}
          onChange={(e) => onChange({ audience: e.target.value as CampaignAudience })}
          className={inputClasses}
        >
          {AUDIENCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="text-xs">{selectedAudience?.description}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm text-textMuted">
        Estado de la estadía
        <select value={filter.stayFilter ?? ''} onChange={(e) => changeStay(e.target.value)} className={inputClasses}>
          <option value="">Sin filtrar por estadía</option>
          {STAY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedStay && <span className="text-xs">{selectedStay.description}</span>}
      </label>

      {selectedStay?.rangeLabel && (
        <div className="space-y-1 text-sm text-textMuted">
          <span>{selectedStay.rangeLabel} entre (opcional)</span>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
            <input
              type="date"
              aria-label={`${selectedStay.rangeLabel} desde`}
              value={filter.stayFrom ?? ''}
              max={filter.stayTo ?? undefined}
              onChange={(e) => onChange({ stayFrom: e.target.value || null })}
              className={inputClasses}
            />
            <span className="hidden text-xs sm:block">y</span>
            <input
              type="date"
              aria-label={`${selectedStay.rangeLabel} hasta`}
              value={filter.stayTo ?? ''}
              min={filter.stayFrom ?? undefined}
              onChange={(e) => onChange({ stayTo: e.target.value || null })}
              className={inputClasses}
            />
          </div>
        </div>
      )}

      <div className="space-y-1 text-sm text-textMuted">
        <span>Cantidad de personas (opcional)</span>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GUESTS_FILTER}
            aria-label="Mínimo de personas"
            placeholder="Mínimo"
            value={filter.minGuests ?? ''}
            onChange={(e) => onChange({ minGuests: toGuests(e.target.value) })}
            className={inputClasses}
          />
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_GUESTS_FILTER}
            aria-label="Máximo de personas"
            placeholder="Máximo"
            value={filter.maxGuests ?? ''}
            onChange={(e) => onChange({ maxGuests: toGuests(e.target.value) })}
            className={inputClasses}
          />
        </div>
        {hasGuests && (
          <p className="text-xs">
            {selectedStay?.value === 'QUOTED'
              ? 'Se mira cuántas personas pidieron en la consulta.'
              : `${
                  selectedStay
                    ? 'Se mira la misma reserva que cumple el estado elegido.'
                    : 'Solo entran contactos con al menos una reserva para esa cantidad de personas. Para quienes consultaron sin reservar, elegí ese estado.'
                } En reservas anteriores que no guardaron el dato se usa la capacidad de la habitación.`}
          </p>
        )}
      </div>

      <p aria-live="polite" className="text-sm">
        {error ? (
          <span className="text-dangerText">{error}</span>
        ) : recipients === null ? (
          <span className="text-textMuted">Contando…</span>
        ) : recipients === 0 ? (
          <span className="text-dangerText">Ningún contacto cumple estos filtros. Probá con otros.</span>
        ) : (
          <span className="text-textMuted">
            Destinatarios: <strong className="text-text">{pluralizeContacts(recipients)}</strong>.
          </span>
        )}
      </p>
    </fieldset>
  );
}
