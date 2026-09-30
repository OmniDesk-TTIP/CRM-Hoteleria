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
import { seedUser, bearer } from './auth.helper';
import { User, UserRole } from '../src/infrastructure/database/entities/User.entity';
import { SupportHours } from '../src/infrastructure/database/entities/SupportHours.entity';

describe('Support Hours (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const week = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '09:00',
    closesAt: '21:00',
  }));

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
      .useValue({ launch: jest.fn(), stop: jest.fn(), on: jest.fn(), start: jest.fn(), use: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);
  });

  afterAll(async () => {
    try {
      // La semana que crea el PUT no puede sobrevivir a esta suite: si queda, el handover de
      // telegram.e2e cae en "fuera de horario" y deja de silenciar al bot.
      await em.nativeDelete(SupportHours, { weekday: { $gte: 0 } });
      await em.nativeDelete(User, { email: { $in: [admin.user.email, employee.user.email] } });
    } catch (e) {
    } finally {
      // Fuera del try: si la limpieza falla, la app se cierra igual y jest puede terminar.
      if (app) await app.close();
    }
  });

  describe('Autorización', () => {
    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/support-hours').expect(401);
      await request(app.getHttpServer()).put('/support-hours').send({ days: week }).expect(401);
    });

    it('cualquier operador puede leerlos, solo un Administrador puede editarlos', async () => {
      await request(app.getHttpServer())
        .get('/support-hours')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      await request(app.getHttpServer())
        .put('/support-hours')
        .set('Authorization', bearer(employee.accessToken))
        .send({ days: week })
        .expect(403);
    });
  });

  describe('PUT /support-hours (CA5)', () => {
    it('guarda la semana completa y la devuelve con la zona horaria configurada', async () => {
      const { body } = await request(app.getHttpServer())
        .put('/support-hours')
        .set('Authorization', bearer(admin.accessToken))
        .send({ days: week.map((day) => (day.weekday === 0 ? { ...day, isClosed: true } : day)) })
        .expect(200);

      expect(body.days).toHaveLength(7);
      expect(body.timeZone).toBeTruthy();
      expect(body.days.find((day: any) => day.weekday === 0)).toMatchObject({ isClosed: true });
    });

    it('es idempotente: un segundo PUT actualiza las filas en vez de duplicarlas', async () => {
      await request(app.getHttpServer())
        .put('/support-hours')
        .set('Authorization', bearer(admin.accessToken))
        .send({ days: week.map((day) => ({ ...day, opensAt: '08:00' })) })
        .expect(200);

      const persisted = await em.fork().find(SupportHours, {});
      expect(persisted).toHaveLength(7);
      expect(persisted.every((day) => day.opensAt === '08:00')).toBe(true);
    });

    it('rechaza una semana incompleta o con horas mal formadas', async () => {
      await request(app.getHttpServer())
        .put('/support-hours')
        .set('Authorization', bearer(admin.accessToken))
        .send({ days: week.slice(0, 5) })
        .expect(400);

      await request(app.getHttpServer())
        .put('/support-hours')
        .set('Authorization', bearer(admin.accessToken))
        .send({ days: week.map((day) => (day.weekday === 2 ? { ...day, opensAt: '9am' } : day)) })
        .expect(400);
    });

    it('rechaza un día abierto que abre y cierra a la misma hora', async () => {
      await request(app.getHttpServer())
        .put('/support-hours')
        .set('Authorization', bearer(admin.accessToken))
        .send({ days: week.map((day) => (day.weekday === 3 ? { ...day, opensAt: '10:00', closesAt: '10:00' } : day)) })
        .expect(400);
    });
  });
});
