import { SatisfactionSurveyModel } from '../satisfactionSurvey.model';

/** Una respuesta en el panel (`/surveys`). */
export class SurveyResponseDto {
  id!: string;
  reservationId!: string;
  guestFullName!: string;
  roomNumber!: string | null;
  /** YYYY-MM-DD */
  checkIn!: string | null;
  /** YYYY-MM-DD */
  checkOut!: string | null;
  answeredAt!: string;
  overallRating!: number;
  cleanlinessRating!: number;
  attentionRating!: number;
  servicesRating!: number;
  comment!: string | null;
  publishConsent!: boolean;
  published!: boolean;
  publishedAt!: string | null;

  /** Solo para encuestas respondidas: el repository filtra por estado. */
  static fromModel(model: SatisfactionSurveyModel): SurveyResponseDto {
    if (!model.answer || !model.answeredAt) {
      throw new Error(`La encuesta ${model.id} no tiene respuesta`);
    }

    const dto = new SurveyResponseDto();
    dto.id = model.id;
    dto.reservationId = model.reservationId;
    dto.guestFullName = model.stay?.guestFullName ?? '';
    dto.roomNumber = model.stay?.roomNumber ?? null;
    dto.checkIn = model.stay?.checkIn ?? null;
    dto.checkOut = model.stay?.checkOut ?? null;
    dto.answeredAt = model.answeredAt.toISOString();
    dto.overallRating = model.answer.overallRating;
    dto.cleanlinessRating = model.answer.cleanlinessRating;
    dto.attentionRating = model.answer.attentionRating;
    dto.servicesRating = model.answer.servicesRating;
    dto.comment = model.answer.comment;
    dto.publishConsent = model.answer.publishConsent;
    dto.published = model.isPublished;
    dto.publishedAt = model.publishedAt
      ? model.publishedAt.toISOString()
      : null;
    return dto;
  }
}

export interface PaginatedSurveyResponsesDto {
  items: SurveyResponseDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Resumen del período (CA5). Los promedios son null si no hubo respuestas. */
export class SurveySummaryDto {
  /** YYYY-MM-DD o null si el período no tiene ese límite. */
  from!: string | null;
  to!: string | null;
  /** Respuestas recibidas en el período. */
  responses!: number;
  averages!: {
    overall: number | null;
    cleanliness: number | null;
    attention: number | null;
    services: number | null;
  };
  /** Invitaciones enviadas en el período y cuántas de esas ya se respondieron. */
  invitations!: { sent: number; answered: number; responseRatePct: number };
}
