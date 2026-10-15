import { PERIOD_OPTIONS, type ReviewPeriodPreset } from '@/components/reviews/periods';
import type { SurveyPeriod } from '@/config/types';

interface PeriodFilterProps {
  preset: ReviewPeriodPreset;
  onPresetChange: (preset: ReviewPeriodPreset) => void;
  /** Fechas del rango personalizado; solo se muestran con el preset `custom`. */
  custom: SurveyPeriod;
  onCustomChange: (period: SurveyPeriod) => void;
  /** Hoy (YYYY-MM-DD): no tiene sentido pedir respuestas del futuro. */
  today: string;
}

const dateInputClasses =
  'rounded-xl border border-goldLight/20 bg-surface px-3 py-1.5 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60';

export default function PeriodFilter({ preset, onPresetChange, custom, onCustomChange, today }: PeriodFilterProps) {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label="Período"
        className="grid w-full grid-cols-2 gap-1 rounded-2xl border border-goldLight/20 bg-surface p-1 sm:inline-grid sm:w-auto sm:grid-cols-4 sm:rounded-full"
      >
        {PERIOD_OPTIONS.map(({ value, label }) => {
          const isActive = value === preset;

          return (
            <button
              key={value}
              type="button"
              onClick={() => onPresetChange(value)}
              aria-pressed={isActive}
              className={`rounded-full px-2 py-1.5 text-xs font-medium transition motion-reduce:transition-none sm:px-4 sm:text-sm ${
                isActive ? 'bg-gold text-shell' : 'text-textMuted hover:text-goldLight'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {preset === 'custom' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-textMuted">
            Desde
            <input
              type="date"
              value={custom.from ?? ''}
              max={custom.to ?? today}
              onChange={(e) => onCustomChange({ ...custom, from: e.target.value || undefined })}
              className={dateInputClasses}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-textMuted">
            Hasta
            <input
              type="date"
              value={custom.to ?? ''}
              min={custom.from}
              max={today}
              onChange={(e) => onCustomChange({ ...custom, to: e.target.value || undefined })}
              className={dateInputClasses}
            />
          </label>
        </div>
      )}
    </div>
  );
}
