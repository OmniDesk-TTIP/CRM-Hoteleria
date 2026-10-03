import type { StatisticsRange } from '@/config/types';
import { RANGE_OPTIONS } from '@/components/statistics/ranges';

interface RangeSelectorProps {
  value: StatisticsRange;
  onChange: (range: StatisticsRange) => void;
}

export default function RangeSelector({ value, onChange }: RangeSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Período"
      className="grid w-full grid-cols-3 gap-1 rounded-full border border-goldLight/20 bg-surface p-1 sm:inline-grid sm:w-auto"
    >
      {RANGE_OPTIONS.map(({ value: option, label }) => {
        const isActive = option === value;

        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
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
  );
}
