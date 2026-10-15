import type { ComponentType, SVGProps } from 'react';
import KpiCard from '@/components/statistics/KpiCard';
import RatingStars from '@/components/reviews/RatingStars';
import { formatRating, MAX_RATING } from '@/components/reviews/format';
import { formatPct } from '@/components/dashboard/format';
import { BellIcon, ChatIcon, HeadsetIcon, SparklesIcon, StarIcon } from '@/components/layout/icons';
import type { SurveySummary } from '@/config/types';

const ASPECTS: {
  key: 'cleanliness' | 'attention' | 'services';
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  { key: 'cleanliness', label: 'Limpieza', icon: SparklesIcon },
  { key: 'attention', label: 'Atención', icon: HeadsetIcon },
  { key: 'services', label: 'Servicios', icon: BellIcon },
];

const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm);

/** Promedio de cada aspecto con una barra sobre 5. */
function AspectAverages({ averages }: { averages: SurveySummary['averages'] }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-gold/40 bg-card/90 p-5 shadow-lg shadow-black/20 md:p-6">
      <h2 className="text-sm font-medium text-textMuted">Promedio por aspecto</h2>

      <ul className="space-y-3">
        {ASPECTS.map(({ key, label, icon: Icon }) => {
          const value = averages[key];

          return (
            <li key={key} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-gold">
                <Icon className="h-5 w-5" />
              </span>
              <span className="w-20 shrink-0 text-sm text-text">{label}</span>
              <span
                className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface"
                role="img"
                aria-label={value === null ? `${label}: sin datos` : `${label}: ${formatRating(value)} de ${MAX_RATING}`}
              >
                <span
                  className="block h-full rounded-full bg-gold"
                  style={{ width: `${((value ?? 0) / MAX_RATING) * 100}%` }}
                />
              </span>
              <span className="w-9 shrink-0 text-right text-sm font-semibold tabular-nums text-text">
                {value === null ? '—' : formatRating(value)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function ReviewsSummary({ summary }: { summary: SurveySummary }) {
  const { responses, averages, invitations } = summary;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        label="Satisfacción general"
        value={averages.overall === null ? '—' : `${formatRating(averages.overall)} / ${MAX_RATING}`}
        icon={StarIcon}
        hint={
          averages.overall === null ? (
            'Todavía no hay respuestas en este período.'
          ) : (
            <RatingStars value={Math.round(averages.overall)} />
          )
        }
      />

      <KpiCard
        label="Respuestas recibidas"
        value={String(responses)}
        icon={ChatIcon}
        hint={
          invitations.sent === 0
            ? 'No se enviaron encuestas en este período.'
            : `Tasa de respuesta: ${formatPct(invitations.responseRatePct)} (${invitations.answered} de ${invitations.sent} ${plural(
                invitations.sent,
                'encuesta enviada',
                'encuestas enviadas',
              )})`
        }
      />

      <div className="flex min-w-0 *:min-w-0 *:flex-1 sm:col-span-2 xl:col-span-1">
        <AspectAverages averages={averages} />
      </div>
    </div>
  );
}
