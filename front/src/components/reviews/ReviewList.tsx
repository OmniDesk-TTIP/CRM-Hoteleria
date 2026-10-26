import type { SurveyResponse } from '@/config/types';
import { ReviewPublicationBadge } from '@/components/admin/Badges';
import { formatIsoDay } from '@/components/admin/spaFormat';
import RatingStars from '@/components/reviews/RatingStars';
import { MAX_RATING } from '@/components/reviews/format';

interface ReviewListProps {
  reviews: SurveyResponse[];
  isLoading: boolean;
  error: string | null;
  /** Id de la reseña que se está publicando u ocultando, para deshabilitar su botón. */
  busyId: string | null;
  onTogglePublication: (review: SurveyResponse) => void;
}

const ASPECTS: { field: 'cleanlinessRating' | 'attentionRating' | 'servicesRating'; label: string }[] = [
  { field: 'cleanlinessRating', label: 'Limpieza' },
  { field: 'attentionRating', label: 'Atención' },
  { field: 'servicesRating', label: 'Servicios' },
];

const publishButtonClasses =
  'rounded-full border border-gold/50 px-4 py-1.5 text-xs font-medium text-goldLight transition hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const hideButtonClasses =
  'rounded-full border border-goldLight/20 px-4 py-1.5 text-xs font-medium text-textMuted transition hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none';

const formatAnsweredAt = (iso: string) => new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(new Date(iso));

const stayLabel = (review: SurveyResponse) =>
  review.checkIn && review.checkOut ? `${formatIsoDay(review.checkIn)} – ${formatIsoDay(review.checkOut)}` : null;

export default function ReviewList({ reviews, isLoading, error, busyId, onTogglePublication }: ReviewListProps) {
  if (isLoading && reviews.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-textMuted">Cargando respuestas…</p>;
  }
  if (error) {
    return <p className="px-5 py-10 text-center text-sm text-dangerText">{error}</p>;
  }
  if (reviews.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-textMuted">No hay respuestas en este período.</p>;
  }

  return (
    <ul className={`divide-y divide-goldLight/10 ${isLoading ? 'opacity-60' : ''}`}>
      {reviews.map((review) => {
        const stay = stayLabel(review);

        return (
          <li key={review.id} className="space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-text">{review.guestFullName}</p>
                <p className="text-xs text-textMuted">
                  {[review.roomNumber && `Hab. ${review.roomNumber}`, stay && `Estadía ${stay}`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>

              <div className="flex flex-col items-start gap-0.5 sm:items-end">
                <span className="flex items-center gap-2">
                  <RatingStars value={review.overallRating} />
                  <span className="text-sm font-semibold tabular-nums text-text">
                    {review.overallRating}/{MAX_RATING}
                  </span>
                </span>
                <span className="text-xs text-textMuted">Respondió el {formatAnsweredAt(review.answeredAt)}</span>
              </div>
            </div>

            <dl className="flex flex-wrap gap-2">
              {ASPECTS.map(({ field, label }) => (
                <div
                  key={field}
                  className="flex items-center gap-1.5 rounded-full border border-goldLight/15 bg-surface px-3 py-1 text-xs"
                >
                  <dt className="text-textMuted">{label}</dt>
                  <dd className="font-semibold tabular-nums text-text">{review[field]}</dd>
                </div>
              ))}
            </dl>

            {review.comment ? (
              <blockquote className="whitespace-pre-line break-words border-l-2 border-gold/40 pl-3 text-sm text-text">
                {review.comment}
              </blockquote>
            ) : (
              <p className="text-sm italic text-textMuted">Sin comentario.</p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <ReviewPublicationBadge published={review.published} publishConsent={review.publishConsent} />

              {/* Sin el consentimiento del huésped no hay nada que decidir: el badge ya lo explica. */}
              {review.publishConsent && (
                <button
                  type="button"
                  disabled={busyId === review.id}
                  onClick={() => onTogglePublication(review)}
                  className={review.published ? hideButtonClasses : publishButtonClasses}
                >
                  {review.published ? 'Ocultar de la web' : 'Publicar en la web'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
