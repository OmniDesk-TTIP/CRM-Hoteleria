import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { createValidationPipe } from '../src/validation.config';
import { hashSurveyToken } from '../src/modules/satisfactionSurvey/satisfactionSurvey.model';
import { seedUser, bearer } from './auth.helper';
import {
  User,
  UserRole,
} from '../src/infrastructure/database/entities/User.entity';
import {
  Room,
  RoomStatus,
} from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationStatus,
} from '../src/infrastructure/database/entities/Reservation.entity';
import {
  SatisfactionSurvey,
  SatisfactionSurveyStatus,
} from '../src/infrastructure/database/entities/SatisfactionSurvey.entity';

/**
 * Lo que agrega la capa HTTP: quién puede ver los resultados (CA6) y la validación del formulario
 * (CA3). El envío por Telegram y las reglas de negocio se prueban en
 * satisfactionSurvey.service.integration-spec.ts.
 */
describe('Encuesta de satisfacción (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  let seq = 0;
  let categoryId: string;
  let roomId: string;
  const reservationIds: string[] = [];

  const VALID_ANSWER = {
    overallRating: 5,
    cleanlinessRating: 4,
    attentionRating: 5,
    servicesRating: 4,
    comment: '  Muy buena atención  ',
    publishConsent: true,
  };

  /** Encuesta enviada y abierta; devuelve el token que tendría el huésped en su link. */
  const seedSurvey = async () => {
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId: `tg-survey-e2e-${suffix}-${++seq}`,
      checkIn: new Date(2097, 0, 10, 12),
      checkOut: new Date(2097, 0, 15, 12),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Beto Huésped',
      guestDni: '30111222',
    });
    const token = `token-e2e-${suffix}-${seq}`;
    const survey = em.create(SatisfactionSurvey, {
      reservation,
      telegramUserId: reservation.telegramUserId!,
      tokenHash: hashSurveyToken(token),
      status: SatisfactionSurveyStatus.SENT,
      sentAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    em.persist([reservation, survey]);
    await em.flush();
    reservationIds.push(reservation.id);
    return { token, surveyId: survey.id };
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ ingestDocument: jest.fn(), askQuestion: jest.fn() })
      .overrideProvider(PaymentService)
      .useValue({
        createPreference: jest.fn(),
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
        telegram: { sendMessage: jest.fn() },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);

    const category = em.create(RoomCategory, {
      name: `Cat survey e2e ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `SURVEY-E2E-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  afterAll(async () => {
    try {
      // Las encuestas se borran en cascada con la reserva.
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('resultados en el panel (CA6)', () => {
    it.each([
      ['GET', '/surveys'],
      ['GET', '/surveys/summary'],
      ['PATCH', '/surveys/00000000-0000-0000-0000-000000000000/publication'],
    ])('%s %s sin token responde 401', async (method, url) => {
      await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'patch'](url)
        .expect(401);
    });

    it.each([
      ['GET', '/surveys'],
      ['GET', '/surveys/summary'],
      ['PATCH', '/surveys/00000000-0000-0000-0000-000000000000/publication'],
    ])('%s %s con un Empleado responde 403', async (method, url) => {
      await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'patch'](url)
        .set('Authorization', bearer(employee.accessToken))
        .send({ published: true })
        .expect(403);
    });

    it('el Administrador ve las respuestas y el resumen', async () => {
      const { token, surveyId } = await seedSurvey();
      await request(app.getHttpServer())
        .post(`/public/surveys/${token}`)
        .send(VALID_ANSWER)
        .expect(201);

      const list = await request(app.getHttpServer())
        .get('/surveys')
        .query({ pageSize: 100 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);
      const item = (list.body.items as { id: string }[]).find(
        (row) => row.id === surveyId,
      );
      expect(item).toMatchObject({
        guestFullName: 'Beto Huésped',
        checkIn: '2097-01-10',
        checkOut: '2097-01-15',
        overallRating: 5,
        comment: 'Muy buena atención',
        published: false,
      });

      const summary = await request(app.getHttpServer())
        .get('/surveys/summary')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);
      expect(summary.body.responses).toBeGreaterThanOrEqual(1);
      expect(summary.body.averages.overall).not.toBeNull();

      const published = await request(app.getHttpServer())
        .patch(`/surveys/${surveyId}/publication`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ published: true })
        .expect(200);
      expect(published.body.published).toBe(true);
    });

    it('valida el filtro de período', async () => {
      const response = await request(app.getHttpServer())
        .get('/surveys/summary')
        .query({ from: '01-09-2097' })
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);
      expect(response.body.message).toBe(
        'from debe tener el formato YYYY-MM-DD',
      );
    });
  });

  describe('formulario público del huésped (CA2, CA3)', () => {
    it('muestra la encuesta sin autenticación', async () => {
      const { token } = await seedSurvey();

      const response = await request(app.getHttpServer())
        .get(`/public/surveys/${token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'OPEN',
        guestFirstName: 'Beto',
      });
      // no expone datos sensibles de la reserva
      expect(JSON.stringify(response.body)).not.toContain('30111222');
    });

    it('un token inexistente responde 404', async () => {
      await request(app.getHttpServer())
        .get('/public/surveys/no-existe')
        .expect(404);
    });

    it.each([
      [
        'sin la calificación general',
        { ...VALID_ANSWER, overallRating: undefined },
        'Falta la calificación de la estadía en general',
      ],
      [
        'sin una calificación por aspecto',
        { ...VALID_ANSWER, servicesRating: undefined },
        'Falta la calificación de servicios',
      ],
      [
        'con una calificación fuera de rango',
        { ...VALID_ANSWER, cleanlinessRating: 6 },
        'La calificación de limpieza debe ser un número entero del 1 al 5',
      ],
      [
        'con una calificación no entera',
        { ...VALID_ANSWER, attentionRating: 3.5 },
        'La calificación de atención debe ser un número entero del 1 al 5',
      ],
      [
        'con un comentario demasiado largo',
        { ...VALID_ANSWER, comment: 'a'.repeat(1001) },
        'El comentario no puede superar los 1000 caracteres',
      ],
    ])('rechaza el envío %s', async (_label, body, message) => {
      const { token } = await seedSurvey();

      const response = await request(app.getHttpServer())
        .post(`/public/surveys/${token}`)
        .send(body)
        .expect(400);

      expect(response.body.message).toBe(message);
      const status = await request(app.getHttpServer())
        .get(`/public/surveys/${token}`)
        .expect(200);
      expect(status.body.status).toBe('OPEN');
    });

    it('acepta una sola respuesta: la segunda responde 409', async () => {
      const { token } = await seedSurvey();

      const first = await request(app.getHttpServer())
        .post(`/public/surveys/${token}`)
        .send(VALID_ANSWER)
        .expect(201);
      expect(first.body.status).toBe('ANSWERED');

      const second = await request(app.getHttpServer())
        .post(`/public/surveys/${token}`)
        .send(VALID_ANSWER)
        .expect(409);
      expect(second.body.message).toBe('Ya respondiste esta encuesta');
    });
  });
});
