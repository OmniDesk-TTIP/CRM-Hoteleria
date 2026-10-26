import { createHash, randomBytes } from 'crypto';
import { v4 } from 'uuid';
import { addDays } from '../../common/date.util';
import { toMinutes } from '../supportHours/supportHours.util';
import { SatisfactionSurveyStatus } from '../../infrastructure/database/entities/SatisfactionSurvey.entity';

export const SURVEY_TTL_DAYS = 30;
export const SURVEY_SEND_AFTER = '12:00';
export const SURVEY_LOOKBACK_DAYS = 7;

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

export type SurveyPublicState = 'OPEN' | 'ANSWERED' | 'EXPIRED';

export interface SurveyStay {
  guestFullName: string;
  checkIn: string;
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

export function surveyCheckOutWindow(
  today: string,
  nowMinutes: number,
): { from: string; to: string } {
  const to =
    nowMinutes >= toMinutes(SURVEY_SEND_AFTER) ? today : addDays(today, -1);
  return { from: addDays(today, -SURVEY_LOOKBACK_DAYS), to };
}

export function formatAuthorName(guestFullName: string): string {
  const words = guestFullName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Huésped';

  const [firstName] = words;
  if (words.length === 1) return firstName;
  return `${firstName} ${words[words.length - 1].charAt(0).toLocaleUpperCase('es-AR')}.`;
}

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

  getPublicState(now: Date): SurveyPublicState {
    if (this.status === SatisfactionSurveyStatus.ANSWERED) return 'ANSWERED';
    if (this.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
    return 'OPEN';
  }

  get isPublished(): boolean {
    return this.publishedAt !== null;
  }

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
