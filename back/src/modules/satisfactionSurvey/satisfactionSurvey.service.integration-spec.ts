import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { SatisfactionSurveyService } from './satisfactionSurvey.service';
import { hashSurveyToken } from './satisfactionSurvey.model';
import { SubmitSurveyDto } from './dto/submitSurvey.dto';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationOrigin,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  SatisfactionSurvey,
  SatisfactionSurveyStatus,
} from '../../infrastructure/database/entities/SatisfactionSurvey.entity';
import {
  ChatMessage,
  MessageRole,
} from '../../infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';

/**
 * Integración de SatisfactionSurveyService contra la base de test: reservas y encuestas son filas
 * reales; Telegram está simulado. "Hoy" lo fija cada test con `now`, en 2098 para no cruzarse con
 * las reservas de otras suites (el cron mira todas las reservas de la ventana).
 *
 * Horario del hotel: Buenos Aires (UTC-3). 16:00 UTC = 13:00 en el hotel.
 */
describe('SatisfactionSurveyService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: SatisfactionSurveyService;

  const sendMessage = jest.fn();
  const LANDING = 'https://hotel.test';
  const previousLanding = process.env.LANDING_BASE_URL;

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  let categoryId: string;
  let roomId: string;
  let roomNumber: string;
  const clientIds: string[] = [];
  const reservationIds: string[] = [];

  const RATINGS: SubmitSurveyDto = {
    overallRating: 5,
    cleanlinessRating: 4,
    attentionRating: 5,
    servicesRating: 3,
  };

  /** Mediodía local: el día calendario no se corre con ninguna zona horaria. */
  const day = (iso: string) => {
    const [year, month, date] = iso.split('-').map(Number);
    return new Date(year, month - 1, date, 12);
  };

  const seedReservation = async (
    checkOut: string,
    overrides: Partial<Reservation> = {},
  ) => {
    const telegramUserId = `tg-survey-${next()}`;
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn: day('2098-01-01'),
      checkOut: day(checkOut),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana María Pérez',
      guestDni: '30111222',
      ...overrides,
    });
    em.persist(reservation);
    await em.flush();
    clientIds.push(telegramUserId);
    reservationIds.push(reservation.id);
    return reservation;
  };

  const surveyOf = (reservationId: string) =>
    em.fork().findOne(SatisfactionSurvey, { reservation: reservationId });

  const messagesTo = (telegramUserId: string) =>
    sendMessage.mock.calls.filter(([chatId]) => chatId === telegramUserId);

  /** Token del link que le llegó al huésped por Telegram. */
  const tokenSentTo = (telegramUserId: string): string => {
    const [call] = messagesTo(telegramUserId);
    if (!call)
      throw new Error(`No se le mandó la encuesta a ${telegramUserId}`);
    const match = /\/encuesta\/([A-Za-z0-9_-]+)/.exec(String(call[1]));
    if (!match) throw new Error('El mensaje no tiene el link de la encuesta');
    return match[1];
  };

  /** Reserva terminada e invitada: devuelve la reserva y el token de su encuesta. */
  const invitedGuest = async (checkOut: string, now: Date) => {
    const reservation = await seedReservation(checkOut);
    await service.sendInvitations(now);
    return {
      reservation,
      token: tokenSentTo(reservation.telegramUserId!),
    };
  };

  beforeAll(async () => {
    process.env.LANDING_BASE_URL = LANDING;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ ingestDocument: jest.fn(), askQuestion: jest.fn() })
      .overrideProvider(PaymentService)
      .useValue({
        createPreference: jest.fn(),
        createSpaPreference: jest.fn(),
        getPayment: jest.fn(),
        verifyWebhookSignature: jest.fn(),
        notifyPaymentApproved: jest.fn(),
      })
      .overrideProvider(getBotToken())
      .useValue({
        launch: jest.fn(),
        stop: jest.fn(),
        on: jest.fn(),
        start: jest.fn(),
        use: jest.fn(),
        telegram: { sendMessage },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(SatisfactionSurveyService);

    roomNumber = `SURVEY-${suffix}`;
    const category = em.create(RoomCategory, {
      name: `Cat survey ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  beforeEach(() => {
    // El service usa el EntityManager global: sin esto podría devolver filas cacheadas de otro test.
    orm.em.clear();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    if (previousLanding === undefined) delete process.env.LANDING_BASE_URL;
    else process.env.LANDING_BASE_URL = previousLanding;

    try {
      await em.nativeDelete(ChatMessage, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(ChatSession, {
        telegramUserId: { $in: clientIds },
      });
      // Las encuestas se borran en cascada con la reserva.
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('envío de la invitación por Chamber (CA1)', () => {
    // 15/06/2098 13:00 en el hotel.
    const NOW = new Date(Date.UTC(2098, 5, 15, 16, 0));

    it('invita al huésped cuya estadía terminó, con un link a la web del hotel', async () => {
      const reservation = await seedReservation('2098-06-14');

      await service.sendInvitations(NOW);

      const [call] = messagesTo(reservation.telegramUserId!);
      expect(call[1]).toMatch(/^¡Hola Ana!/);
      const token = tokenSentTo(reservation.telegramUserId!);

      const survey = await surveyOf(reservation.id);
      expect(survey).toMatchObject({
        telegramUserId: reservation.telegramUserId,
        status: SatisfactionSurveyStatus.SENT,
        sentAt: NOW,
        // solo se guarda el hash del token
        tokenHash: hashSurveyToken(token),
      });
      expect(String(call[1])).toContain(`${LANDING}/encuesta/${token}`);
    });

    it('deja constancia en el chat del panel, sin el link', async () => {
      const reservation = await seedReservation('2098-06-14');

      await service.sendInvitations(NOW);
      const token = tokenSentTo(reservation.telegramUserId!);

      const notices = await em.fork().find(ChatMessage, {
        telegramUserId: reservation.telegramUserId,
        role: MessageRole.SYSTEM,
      });
      expect(notices).toHaveLength(1);
      expect(notices[0].content).toContain('encuesta de satisfacción');
      expect(notices[0].content).not.toContain(token);
    });

    it('invita una sola vez por reserva aunque el cron vuelva a correr', async () => {
      const reservation = await seedReservation('2098-06-13');

      await service.sendInvitations(NOW);
      await service.sendInvitations(NOW);
      await service.sendInvitations(new Date(Date.UTC(2098, 5, 17, 16, 0)));

      expect(messagesTo(reservation.telegramUserId!)).toHaveLength(1);
      expect(
        await em
          .fork()
          .count(SatisfactionSurvey, { reservation: reservation.id }),
      ).toBe(1);
    });

    it('dos corridas simultáneas no duplican la invitación', async () => {
      const reservation = await seedReservation('2098-06-12');

      await Promise.all([
        service.sendInvitations(NOW),
        service.sendInvitations(NOW),
      ]);

      expect(messagesTo(reservation.telegramUserId!)).toHaveLength(1);
    });

    it('el día del checkout espera al mediodía del hotel', async () => {
      const reservation = await seedReservation('2098-06-15');

      // 10:00 en el hotel: el huésped puede seguir en el hotel.
      await service.sendInvitations(new Date(Date.UTC(2098, 5, 15, 13, 0)));
      expect(messagesTo(reservation.telegramUserId!)).toHaveLength(0);

      await service.sendInvitations(NOW);
      expect(messagesTo(reservation.telegramUserId!)).toHaveLength(1);
    });

    it.each([
      [
        'una reserva cancelada',
        '2098-06-14',
        { status: ReservationStatus.CANCELLED },
      ],
      [
        'una reserva sin pagar',
        '2098-06-14',
        { status: ReservationStatus.PENDING_PAYMENT },
      ],
      ['una estadía que todavía no terminó', '2098-06-16', {}],
      ['una estadía que terminó hace más de 7 días', '2098-06-07', {}],
    ])('no invita a %s', async (_label, checkOut, overrides) => {
      const reservation = await seedReservation(checkOut, overrides);

      await service.sendInvitations(NOW);

      expect(messagesTo(reservation.telegramUserId!)).toHaveLength(0);
      expect(await surveyOf(reservation.id)).toBeNull();
    });

    it('no invita a una reserva cargada a mano sin chat de Telegram', async () => {
      const reservation = await seedReservation('2098-06-14', {
        telegramUserId: undefined,
        origin: ReservationOrigin.MANUAL,
      });

      await service.sendInvitations(NOW);

      expect(await surveyOf(reservation.id)).toBeNull();
    });

    it('si Telegram falla la marca SEND_FAILED y no la reintenta', async () => {
      const reservation = await seedReservation('2098-06-11');
      sendMessage.mockImplementation((chatId: string) =>
        chatId === reservation.telegramUserId
          ? Promise.reject(new Error('403: bot was blocked by the user'))
          : Promise.resolve(undefined),
      );

      await service.sendInvitations(NOW);
      expect((await surveyOf(reservation.id))?.status).toBe(
        SatisfactionSurveyStatus.SEND_FAILED,
      );

      sendMessage.mockReset();
      sendMessage.mockResolvedValue(undefined);
      await service.sendInvitations(NOW);
      expect(messagesTo(reservation.telegramUserId!)).toHaveLength(0);
    });

    it('sin LANDING_BASE_URL no manda nada', async () => {
      const reservation = await seedReservation('2098-06-14');
      delete process.env.LANDING_BASE_URL;

      try {
        expect(await service.sendInvitations(NOW)).toBe(0);
      } finally {
        process.env.LANDING_BASE_URL = LANDING;
      }
      expect(await surveyOf(reservation.id)).toBeNull();
    });
  });

  describe('respuesta del huésped (CA2, CA3, CA4)', () => {
    // 22/07/2098 13:00 en el hotel.
    const NOW = new Date(Date.UTC(2098, 6, 22, 16, 0));
    const LATER = new Date(Date.UTC(2098, 6, 25, 16, 0));

    it('muestra la encuesta abierta con los datos de la estadía', async () => {
      const { token } = await invitedGuest('2098-07-21', NOW);

      const survey = await service.getForGuest(token, LATER);

      expect(survey).toMatchObject({
        status: 'OPEN',
        guestFirstName: 'Ana',
        checkIn: '2098-01-01',
        checkOut: '2098-07-21',
      });
      expect(survey.aspects.map((aspect) => aspect.label)).toEqual([
        'Limpieza',
        'Atención',
        'Servicios',
      ]);
    });

    it('un token desconocido responde 404', async () => {
      await expect(
        service.getForGuest('no-es-un-token', LATER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.submit('x'.repeat(500), RATINGS, LATER),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('guarda la respuesta asociada a la reserva y al huésped', async () => {
      const { reservation, token } = await invitedGuest('2098-07-20', NOW);

      const result = await service.submit(
        token,
        { ...RATINGS, comment: 'Muy lindo todo', publishConsent: true },
        LATER,
      );

      expect(result.status).toBe('ANSWERED');
      const survey = await surveyOf(reservation.id);
      expect(survey).toMatchObject({
        telegramUserId: reservation.telegramUserId,
        status: SatisfactionSurveyStatus.ANSWERED,
        answeredAt: LATER,
        overallRating: 5,
        cleanlinessRating: 4,
        attentionRating: 5,
        servicesRating: 3,
        comment: 'Muy lindo todo',
        publishConsent: true,
        publishedAt: null,
      });
    });

    it('el comentario es opcional y sin consentimiento no se puede publicar', async () => {
      const { reservation, token } = await invitedGuest('2098-07-19', NOW);

      await service.submit(token, RATINGS, LATER);

      const survey = await surveyOf(reservation.id);
      expect(survey?.comment ?? null).toBeNull();
      expect(survey?.publishConsent).toBe(false);
    });

    it('no admite una segunda respuesta y conserva la primera', async () => {
      const { reservation, token } = await invitedGuest('2098-07-18', NOW);
      await service.submit(token, RATINGS, LATER);

      await expect(
        service.submit(token, { ...RATINGS, overallRating: 1 }, LATER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await service.getForGuest(token, LATER)).status).toBe('ANSWERED');
      expect((await surveyOf(reservation.id))?.overallRating).toBe(5);
    });

    it('dos envíos simultáneos: uno se guarda y el otro recibe 409', async () => {
      const { token } = await invitedGuest('2098-07-17', NOW);

      const results = await Promise.allSettled([
        service.submit(token, RATINGS, LATER),
        service.submit(token, { ...RATINGS, overallRating: 1 }, LATER),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected');
      expect(rejected.reason).toBeInstanceOf(ConflictException);
    });

    it('con el link vencido no se puede responder', async () => {
      const { reservation, token } = await invitedGuest('2098-07-16', NOW);
      const expired = new Date(Date.UTC(2098, 7, 30));

      expect((await service.getForGuest(token, expired)).status).toBe(
        'EXPIRED',
      );
      await expect(
        service.submit(token, RATINGS, expired),
      ).rejects.toBeInstanceOf(GoneException);
      expect((await surveyOf(reservation.id))?.status).toBe(
        SatisfactionSurveyStatus.SENT,
      );
    });
  });

  describe('resultados en el panel (CA5)', () => {
    // 10/09/2098 13:00 en el hotel.
    const NOW = new Date(Date.UTC(2098, 8, 10, 16, 0));
    const SEPTEMBER = { from: '2098-09-01', to: '2098-09-30' };

    let answeredWithConsent: string;
    let answeredWithoutConsent: string;
    let answeredInOctober: string;

    beforeAll(async () => {
      const first = await seedReservation('2098-09-09');
      const second = await seedReservation('2098-09-08');
      const third = await seedReservation('2098-09-07');
      // la cuarta no se responde: cuenta como enviada para la tasa de respuesta
      await seedReservation('2098-09-06');
      await service.sendInvitations(NOW);

      await service.submit(
        tokenSentTo(first.telegramUserId!),
        {
          overallRating: 5,
          cleanlinessRating: 4,
          attentionRating: 3,
          servicesRating: 2,
          comment: 'Volvería',
          publishConsent: true,
        },
        new Date(Date.UTC(2098, 8, 12, 15, 0)),
      );
      // 30/09 23:00 en el hotel (01/10 en UTC): cuenta para septiembre.
      await service.submit(
        tokenSentTo(second.telegramUserId!),
        {
          overallRating: 4,
          cleanlinessRating: 4,
          attentionRating: 4,
          servicesRating: 4,
        },
        new Date(Date.UTC(2098, 9, 1, 2, 0)),
      );
      // 01/10 08:00 en el hotel: ya es octubre.
      await service.submit(
        tokenSentTo(third.telegramUserId!),
        { ...RATINGS, overallRating: 1 },
        new Date(Date.UTC(2098, 9, 1, 11, 0)),
      );

      answeredWithConsent = (await surveyOf(first.id))!.id;
      answeredWithoutConsent = (await surveyOf(second.id))!.id;
      answeredInOctober = (await surveyOf(third.id))!.id;
    });

    it('lista las respuestas del período con los datos de la reserva', async () => {
      const page = await service.list({ ...SEPTEMBER, page: 1, pageSize: 10 });

      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.id)).toEqual([
        answeredWithoutConsent,
        answeredWithConsent,
      ]);
      expect(page.items[1]).toMatchObject({
        guestFullName: 'Ana María Pérez',
        roomNumber,
        checkOut: '2098-09-09',
        overallRating: 5,
        comment: 'Volvería',
        publishConsent: true,
        published: false,
      });
    });

    it('el período se corta con el calendario del hotel, no con el de UTC', async () => {
      const october = await service.list({
        from: '2098-10-01',
        to: '2098-10-31',
        page: 1,
        pageSize: 10,
      });

      expect(october.items.map((item) => item.id)).toEqual([answeredInOctober]);
    });

    it('promedia cada aspecto y calcula la tasa de respuesta del período', async () => {
      const summary = await service.getSummary(SEPTEMBER);

      expect(summary).toEqual({
        from: '2098-09-01',
        to: '2098-09-30',
        responses: 2,
        averages: {
          overall: 4.5,
          cleanliness: 4,
          attention: 3.5,
          services: 3,
        },
        // las 4 invitaciones salieron el 10/09; 3 ya se respondieron
        invitations: { sent: 4, answered: 3, responseRatePct: 75 },
      });
    });

    it('un período sin respuestas devuelve promedios en null', async () => {
      const summary = await service.getSummary({
        from: '2098-12-01',
        to: '2098-12-31',
      });

      expect(summary.responses).toBe(0);
      expect(summary.averages.overall).toBeNull();
      expect(summary.invitations.responseRatePct).toBe(0);
    });

    it('rechaza períodos inválidos', async () => {
      await expect(
        service.getSummary({ from: '2098-09-30', to: '2098-09-01' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.list({ from: '2098-02-30', page: 1, pageSize: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('el admin publica solo reseñas con consentimiento', async () => {
      await expect(
        service.setPublication(answeredWithoutConsent, true, NOW),
      ).rejects.toBeInstanceOf(BadRequestException);

      const published = await service.setPublication(
        answeredWithConsent,
        true,
        NOW,
      );
      expect(published).toMatchObject({ published: true });
      expect(
        (await em.fork().findOne(SatisfactionSurvey, answeredWithConsent))
          ?.publishedAt,
      ).toEqual(NOW);

      const hidden = await service.setPublication(
        answeredWithConsent,
        false,
        NOW,
      );
      expect(hidden).toMatchObject({ published: false, publishedAt: null });
    });

    it('publicar una encuesta inexistente responde 404', async () => {
      await expect(
        service.setPublication(
          '00000000-0000-0000-0000-000000000000',
          true,
          NOW,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
