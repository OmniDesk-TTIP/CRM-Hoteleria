import {
  SatisfactionSurveyModel,
  SURVEY_ASPECTS,
  SurveyPublicState,
} from '../satisfactionSurvey.model';

/**
 * Respuesta de `/public/surveys/:token`: lo que necesita la web para mostrar el formulario o
 * avisar que ya se respondió o que el link venció. No expone datos sensibles de la reserva.
 */
export class PublicSurveyDto {
  status!: SurveyPublicState;
  guestFirstName!: string;
  /** YYYY-MM-DD */
  checkIn!: string | null;
  /** YYYY-MM-DD */
  checkOut!: string | null;
  expiresAt!: string;
  /** Aspectos a calificar, con el campo del body que corresponde a cada uno. */
  aspects!: { field: string; label: string }[];

  static fromModel(model: SatisfactionSurveyModel, now: Date): PublicSurveyDto {
    const dto = new PublicSurveyDto();
    dto.status = model.getPublicState(now);
    dto.guestFirstName = model.stay?.guestFullName.trim().split(/\s+/)[0] ?? '';
    dto.checkIn = model.stay?.checkIn ?? null;
    dto.checkOut = model.stay?.checkOut ?? null;
    dto.expiresAt = model.expiresAt.toISOString();
    dto.aspects = SURVEY_ASPECTS.map((aspect) => ({ ...aspect }));
    return dto;
  }
}
