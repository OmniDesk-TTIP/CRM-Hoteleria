import { StarIcon } from '@/components/layout/icons';
import { MAX_RATING } from '@/components/reviews/format';

/** Calificación de 1 a 5 en estrellas. El número va en el aria-label para lectores de pantalla. */
export default function RatingStars({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} de ${MAX_RATING}`}>
      {Array.from({ length: MAX_RATING }, (_, index) => (
        <StarIcon
          key={index}
          className={`${size} ${index < value ? 'fill-gold text-gold' : 'text-goldLight/30'}`}
        />
      ))}
    </span>
  );
}
