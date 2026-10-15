import { SatisfactionSurveyStatus } from '../../infrastructure/database/entities/SatisfactionSurvey.entity';
import {
  buildInvitationMessage,
  formatAuthorName,
  hashSurveyToken,
  SatisfactionSurveyModel,
  SatisfactionSurveyProps,
  SURVEY_LOOKBACK_DAYS,
  SURVEY_TTL_DAYS,
  surveyCheckOutWindow,
} from './satisfactionSurvey.model';

/**
 * Solo reglas puras. El envío por Telegram, la respuesta del huésped y los filtros del panel se
 * prueban contra la base en satisfactionSurvey.service.integration-spec.ts.
 */
const NOW = new Date('2026-10-10T15:00:00Z');

const buildProps = (
  overrides: Partial<SatisfactionSurveyProps> = {},
): SatisfactionSurveyProps => ({
  id: 'survey-1',
  reservationId: 'reservation-1',
  telegramUserId: 'tg-1',
  status: SatisfactionSurveyStatus.SENT,
  expiresAt: new Date('2026-11-01T00:00:00Z'),
  sentAt: NOW,
  answeredAt: null,
  answer: null,
  publishedAt: null,
  stay: null,
  ...overrides,
});

const answered = (publishConsent: boolean) =>
  new SatisfactionSurveyModel(
    buildProps({
      status: SatisfactionSurveyStatus.ANSWERED,
      answeredAt: NOW,
      answer: {
        overallRating: 5,
        cleanlinessRating: 4,
        attentionRating: 5,
        servicesRating: 3,
        comment: 'Excelente',
        publishConsent,
      },
    }),
  );

describe('surveyCheckOutWindow', () => {
  it('antes del mediodía, los que salen hoy todavía no entran', () => {
    expect(surveyCheckOutWindow('2026-10-10', 11 * 60 + 59)).toEqual({
      from: '2026-10-03',
      to: '2026-10-09',
    });
  });

  it('desde el mediodía entran los checkouts de hoy', () => {
    expect(surveyCheckOutWindow('2026-10-10', 12 * 60)).toEqual({
      from: '2026-10-03',
      to: '2026-10-10',
    });
  });

  it(`no mira más de ${SURVEY_LOOKBACK_DAYS} días hacia atrás, aunque cruce de mes`, () => {
    expect(surveyCheckOutWindow('2026-03-02', 13 * 60).from).toBe('2026-02-23');
  });
});

describe('SatisfactionSurveyModel.createInvitation', () => {
  it('genera un token distinto cada vez y guarda solo su hash', () => {
    const first = SatisfactionSurveyModel.createInvitation({
      reservationId: 'r-1',
      telegramUserId: 'tg-1',
      now: NOW,
    });
    const second = SatisfactionSurveyModel.createInvitation({
      reservationId: 'r-1',
      telegramUserId: 'tg-1',
      now: NOW,
    });

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashSurveyToken(first.token));
    expect(first.tokenHash).not.toContain(first.token);
  });

  it(`arranca PENDING y vence a los ${SURVEY_TTL_DAYS} días`, () => {
    const { survey } = SatisfactionSurveyModel.createInvitation({
      reservationId: 'r-1',
      telegramUserId: 'tg-1',
      now: NOW,
    });

    expect(survey.status).toBe(SatisfactionSurveyStatus.PENDING);
    expect(survey.expiresAt.getTime() - NOW.getTime()).toBe(
      SURVEY_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});

describe('SatisfactionSurveyModel.getPublicState', () => {
  it.each([
    SatisfactionSurveyStatus.PENDING,
    SatisfactionSurveyStatus.SENT,
    // Quien tiene el token recibió el mensaje, aunque Telegram haya devuelto error.
    SatisfactionSurveyStatus.SEND_FAILED,
  ])('una encuesta %s sin vencer está abierta', (status) => {
    expect(
      new SatisfactionSurveyModel(buildProps({ status })).getPublicState(NOW),
    ).toBe('OPEN');
  });

  it('vence justo en expiresAt', () => {
    const survey = new SatisfactionSurveyModel(buildProps({ expiresAt: NOW }));
    expect(survey.getPublicState(NOW)).toBe('EXPIRED');
  });

  it('una respondida figura como respondida aunque haya vencido', () => {
    const survey = answered(false);
    expect(survey.getPublicState(new Date('2099-01-01'))).toBe('ANSWERED');
  });
});

describe('SatisfactionSurveyModel.setPublished', () => {
  it('no publica una encuesta sin responder', () => {
    const survey = new SatisfactionSurveyModel(buildProps());
    expect(survey.setPublished(true, NOW)).toBe(
      'La encuesta todavía no fue respondida',
    );
  });

  it('no publica sin el consentimiento del huésped', () => {
    const survey = answered(false);
    expect(survey.setPublished(true, NOW)).toBe(
      'El huésped no autorizó publicar su reseña',
    );
    expect(survey.isPublished).toBe(false);
  });

  it('publica y despublica con consentimiento', () => {
    const survey = answered(true);

    expect(survey.setPublished(true, NOW)).toBeNull();
    expect(survey.publishedAt).toEqual(NOW);

    expect(survey.setPublished(false, NOW)).toBeNull();
    expect(survey.isPublished).toBe(false);
  });

  it('volver a publicar no cambia la fecha original', () => {
    const survey = answered(true);
    survey.setPublished(true, NOW);

    survey.setPublished(true, new Date('2026-12-01'));
    expect(survey.publishedAt).toEqual(NOW);
  });
});

describe('buildInvitationMessage', () => {
  it('saluda por el nombre e incluye el link', () => {
    const message = buildInvitationMessage(
      '  Ana María Pérez',
      'https://hotel.test/encuesta/abc',
    );

    expect(message).toMatch(/^¡Hola Ana!/);
    expect(message).toContain('https://hotel.test/encuesta/abc');
  });
});

describe('formatAuthorName', () => {
  it.each([
    ['nombre y apellido', 'Valentina Medina', 'Valentina M.'],
    [
      'dos nombres: la inicial es del último apellido',
      'Ana María Pérez',
      'Ana P.',
    ],
    ['espacios de más', '  Lucía   díaz ', 'Lucía D.'],
    ['apellido con tilde', 'Martín Álvarez', 'Martín Á.'],
    ['un solo nombre', 'Lautaro', 'Lautaro'],
    ['sin nombre', '   ', 'Huésped'],
  ])('%s', (_label, fullName, expected) => {
    expect(formatAuthorName(fullName)).toBe(expected);
  });
});
