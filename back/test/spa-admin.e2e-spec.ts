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
import {
  User,
  UserRole,
} from '../src/infrastructure/database/entities/User.entity';
import {
  SpaService,
  SpaServiceStatus,
} from '../src/infrastructure/database/entities/SpaService.entity';

describe('Spa services CRUD (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const uniqueSuffix = Date.now();
  const createdIds: string[] = [];

  const buildPayload = (overrides: Record<string, unknown> = {}) => ({
    name: `Masaje E2E ${uniqueSuffix}`,
    description: 'Masaje de 60 minutos',
    durationMinutes: 60,
    price: 15000,
    availableWeekdays: [1, 2, 3],
    opensAt: '10:00',
    closesAt: '20:00',
    ...overrides,
  });

  const createService = async (overrides: Record<string, unknown> = {}) => {
    const response = await request(app.getHttpServer())
      .post('/spa-services')
      .set('Authorization', bearer(admin.accessToken))
      .send(buildPayload(overrides))
      .expect(201);
    createdIds.push(response.body.id);
    return response.body;
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
      })
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
      if (createdIds.length > 0) {
        await em.nativeDelete(SpaService, { id: { $in: createdIds } });
      }
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('Autenticación y autorización', () => {
    it('GET /spa-services sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/spa-services').expect(401);
    });

    it('GET /spa-services con un Empleado responde 200', async () => {
      await request(app.getHttpServer())
        .get('/spa-services')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);
    });

    it('POST /spa-services con un Empleado responde 403', async () => {
      await request(app.getHttpServer())
        .post('/spa-services')
        .set('Authorization', bearer(employee.accessToken))
        .send(buildPayload())
        .expect(403);
    });

    it('PATCH y DELETE con un Empleado responden 403', async () => {
      const id = '00000000-0000-0000-0000-000000000000';
      await request(app.getHttpServer())
        .patch(`/spa-services/${id}`)
        .set('Authorization', bearer(employee.accessToken))
        .send({ price: 1 })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`/spa-services/${id}`)
        .set('Authorization', bearer(employee.accessToken))
        .expect(403);
    });
  });

  describe('POST /spa-services (CA1)', () => {
    it('crea un servicio ACTIVE', async () => {
      const body = await createService();

      expect(body).toMatchObject({
        name: `Masaje E2E ${uniqueSuffix}`,
        durationMinutes: 60,
        price: 15000,
        status: SpaServiceStatus.ACTIVE,
        availableWeekdays: [1, 2, 3],
        opensAt: '10:00',
        closesAt: '20:00',
      });
    });

    it('responde 400 con datos inválidos', async () => {
      await request(app.getHttpServer())
        .post('/spa-services')
        .set('Authorization', bearer(admin.accessToken))
        .send(buildPayload({ name: 'Otro', price: -5 }))
        .expect(400);
      await request(app.getHttpServer())
        .post('/spa-services')
        .set('Authorization', bearer(admin.accessToken))
        .send(buildPayload({ name: 'Otro', opensAt: '25:99' }))
        .expect(400);
      await request(app.getHttpServer())
        .post('/spa-services')
        .set('Authorization', bearer(admin.accessToken))
        .send(buildPayload({ name: 'Otro', availableWeekdays: [7] }))
        .expect(400);
    });
  });

  describe('PATCH /spa-services/:id (CA1)', () => {
    it('edita campos sueltos', async () => {
      const created = await createService({
        name: `Editable ${uniqueSuffix}`,
      });

      const response = await request(app.getHttpServer())
        .patch(`/spa-services/${created.id}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ price: 18000, closesAt: '21:00' })
        .expect(200);

      expect(response.body).toMatchObject({
        id: created.id,
        price: 18000,
        closesAt: '21:00',
        name: `Editable ${uniqueSuffix}`,
      });
    });
  });

  describe('DELETE /spa-services/:id (CA7)', () => {
    const findInPanel = async (id: string) => {
      const panel = await request(app.getHttpServer())
        .get('/spa-services')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);
      return (panel.body as Array<{ id: string; status: string }>).find(
        (s) => s.id === id,
      );
    };

    it('DELETE deshabilita el servicio sin borrarlo', async () => {
      const created = await createService({ name: `Se apaga ${uniqueSuffix}` });

      await request(app.getHttpServer())
        .delete(`/spa-services/${created.id}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);

      expect((await findInPanel(created.id))?.status).toBe(
        SpaServiceStatus.INACTIVE,
      );
    });
  });
});
