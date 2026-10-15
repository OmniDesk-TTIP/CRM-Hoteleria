import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  formatAuthorName,
  SatisfactionSurveyModel,
} from '../satisfactionSurvey.model';

export const PUBLIC_REVIEWS_MAX_PAGE_SIZE = 24;

export class ListPublicReviewsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser mayor a 0' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize debe ser un número entero' })
  @Min(1, { message: 'pageSize debe ser mayor a 0' })
  @Max(PUBLIC_REVIEWS_MAX_PAGE_SIZE, {
    message: `pageSize no puede superar ${PUBLIC_REVIEWS_MAX_PAGE_SIZE}`,
  })
  pageSize: number = 6;
}

/**
 * Reseña tal como se muestra en la web del hotel (`/public/reviews`). Solo lo que el huésped
 * autorizó: nombre e inicial del apellido, la calificación general y su comentario. Nada de la
 * reserva (ni DNI, ni habitación, ni fechas exactas).
 */
export class PublicReviewDto {
  id!: string;
  authorName!: string;
  overallRating!: number;
  comment!: string | null;
  /** Mes del checkout, YYYY-MM. */
  stayMonth!: string | null;
  publishedAt!: string;

  /** Solo para encuestas publicadas: el repository filtra por estado y fecha de publicación. */
  static fromModel(model: SatisfactionSurveyModel): PublicReviewDto {
    if (!model.answer || !model.publishedAt) {
      throw new Error(`La encuesta ${model.id} no está publicada`);
    }

    const dto = new PublicReviewDto();
    dto.id = model.id;
    dto.authorName = formatAuthorName(model.stay?.guestFullName ?? '');
    dto.overallRating = model.answer.overallRating;
    dto.comment = model.answer.comment;
    dto.stayMonth = model.stay?.checkOut.slice(0, 7) ?? null;
    dto.publishedAt = model.publishedAt.toISOString();
    return dto;
  }
}

export interface PaginatedPublicReviewsDto {
  items: PublicReviewDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Resumen para la web. Se calcula sobre todas las encuestas respondidas y no solo sobre las
 * publicadas: si saliera de las que eligió el admin, el promedio quedaría inflado.
 */
export class PublicReviewsSummaryDto {
  /** Con dos decimales; null si todavía no hay opiniones. */
  averageRating!: number | null;
  ratingsCount!: number;
}
