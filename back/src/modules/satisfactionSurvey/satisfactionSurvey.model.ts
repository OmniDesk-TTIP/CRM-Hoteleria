import { createHash, randomBytes } from 'crypto';
import { v4 } from 'uuid';
import { addDays } from '../dashboard/dashboard.util';
import { toMinutes } from '../supportHours/supportHours.util';
import { SatisfactionSurveyStatus } from '../../infrastructure/database/entities/SatisfactionSurvey.entity';

/** Días que el link de la encuesta sigue abierto desde que se crea la invitación. */
export const SURVEY_TTL_DAYS = 30;

/**
 * Hora del hotel desde la que se manda la encuesta el mismo día del checkout: antes de eso el
 * huésped puede seguir en el hotel.
 */
export const SURVEY_SEND_AFTER = '12:00';

/**
 * Las estadías que terminaron hace más de estos días no reciben encuesta. Sin este límite, al
 * desplegar la feature se invitaría a todos los huéspedes históricos.
 */
export const SURVEY_LOOKBACK_DAYS = 7;

/** Aspectos que el huésped califica además de la calificación general (CA2). */
export const SURVEY_ASPECTS = [
  { field: 'cleanlinessRating', label: 'Limpieza' },
  { field: 'attentionRating', label: 'Atención' },
  { field: 'servicesRating', label: 'Servicios' },
] as const;

export interface SurveyRatings {
  overallRating: number;
  cleanlinessRating: number;
  attentionRating: number;
  servicesRating: number;
}

export interface SurveyAnswer extends SurveyRatings {
  comment: string | null;
  publishConsent: boolean;
}

/** Lo que el huésped ve al abrir el link. */
export type SurveyPublicState = 'OPEN' | 'ANSWERED' | 'EXPIRED';

/** Datos de la estadía para mostrar junto a la encuesta. */
export interface SurveyStay {
  guestFullName: string;
  /** YYYY-MM-DD */
  checkIn: string;
  /** YYYY-MM-DD */
  checkOut: string;
  roomNumber: string | null;
}

export interface SatisfactionSurveyProps {
  id: string;
  reservationId: string;
  telegramUserId: string;
  status: SatisfactionSurveyStatus;
  expiresAt: Date;
  sentAt: Date | null;
  answeredAt: Date | null;
  answer: SurveyAnswer | null;
  publishedAt: Date | null;
  stay: SurveyStay | null;
}

export function hashSurveyToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Rango de checkouts (YYYY-MM-DD, calendario del hotel) que ya pueden recibir la encuesta. Los
 * que salen hoy entran recién después de SURVEY_SEND_AFTER.
 */
export function surveyCheckOutWindow(
  today: string,
  nowMinutes: number,
): { from: string; to: string } {
  const to =
    nowMinutes >= toMinutes(SURVEY_SEND_AFTER) ? today : addDays(today, -1);
  return { from: addDays(today, -SURVEY_LOOKBACK_DAYS), to };
}

/** Mensaje de Chamber con el link a la encuesta. Va como texto plano. */
export function buildInvitationMessage(
  guestFullName: string,
  link: string,
): string {
  const firstName = guestFullName.trim().split(/\s+/)[0];
  return [
    `¡Hola ${firstName}! Gracias por hospedarte con nosotros.`,
    '',
    'Nos ayudaría mucho saber cómo fue tu estadía. Completar la encuesta te lleva menos de un minuto:',
    link,
    '',
    `El link está disponible durante ${SURVEY_TTL_DAYS} días.`,
  ].join('\n');
}

/**
 * Regla de negocio de una encuesta de satisfacción. Pura: sin DB ni ORM.
 * El repository la convierte desde y hacia la entidad.
 */
export class SatisfactionSurveyModel {
  readonly id: string;
  readonly reservationId: string;
  readonly telegramUserId: string;
  status: SatisfactionSurveyStatus;
  readonly expiresAt: Date;
  sentAt: Date | null;
  answeredAt: Date | null;
  answer: SurveyAnswer | null;
  publishedAt: Date | null;
  readonly stay: SurveyStay | null;

  constructor(props: SatisfactionSurveyProps) {
    this.id = props.id;
    this.reservationId = props.reservationId;
    this.telegramUserId = props.telegramUserId;
    this.status = props.status;
    this.expiresAt = props.expiresAt;
    this.sentAt = props.sentAt;
    this.answeredAt = props.answeredAt;
    this.answer = props.answer;
    this.publishedAt = props.publishedAt;
    this.stay = props.stay;
  }

  /**
   * Nueva invitación para una reserva. El token solo existe en el valor devuelto (va en el link
   * de Telegram); la encuesta guarda su hash.
   */
  static createInvitation(input: {
    reservationId: string;
    telegramUserId: string;
    now: Date;
  }): { survey: SatisfactionSurveyModel; token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    const survey = new SatisfactionSurveyModel({
      id: v4(),
      reservationId: input.reservationId,
      telegramUserId: input.telegramUserId,
      status: SatisfactionSurveyStatus.PENDING,
      expiresAt: new Date(
        input.now.getTime() + SURVEY_TTL_DAYS * 24 * 60 * 60 * 1000,
      ),
      sentAt: null,
      answeredAt: null,
      answer: null,
      publishedAt: null,
      stay: null,
    });
    return { survey, token, tokenHash: hashSurveyToken(token) };
  }

  /**
   * Una encuesta sin responder se puede contestar hasta que vence, aunque Telegram haya dado
   * error al mandarla: el token viaja solo en ese mensaje, así que quien lo tiene lo recibió.
   */
  getPublicState(now: Date): SurveyPublicState {
    if (this.status === SatisfactionSurveyStatus.ANSWERED) return 'ANSWERED';
    if (this.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
    return 'OPEN';
  }

  get isPublished(): boolean {
    return this.publishedAt !== null;
  }

  /**
   * Publicar o despublicar la reseña en la web del hotel. Solo se publica una encuesta
   * respondida y con el consentimiento del huésped. Devuelve el motivo si no se pudo, o null.
   */
  setPublished(published: boolean, now: Date): string | null {
    if (this.status !== SatisfactionSurveyStatus.ANSWERED || !this.answer) {
      return 'La encuesta todavía no fue respondida';
    }
    if (published && !this.answer.publishConsent) {
      return 'El huésped no autorizó publicar su reseña';
    }
    if (published === this.isPublished) return null;

    this.publishedAt = published ? now : null;
    return null;
  }
}
