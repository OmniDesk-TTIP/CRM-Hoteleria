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
import { Promotion } from '../src/infrastructure/database/entities/Promotion.entity';

describe('Promociones (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;
  const createdIds: string[] = [];

  const SOME_ID = '00000000-0000-4000-8000-000000000000';
  const body = {
    title: 'Escapada e2e',
    description: 'Descuento de temporada',
    discountPercentage: 20,
    startDate: '2099-01-01',
    endDate: '2099-01-31',
    target: 'ROOMS',
    minNights: 3,
  };

  const asAdmin = (method: 'get' | 'post' | 'patch' | 'delete', url: string) =>
    request(app.getHttpServer())
      [method](url)
      .set('Authorization', bearer(admin.accessToken));

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
        action: jest.fn(),
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
      await em.nativeDelete(Promotion, { id: { $in: createdIds } });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  const ENDPOINTS: ['get' | 'post' | 'patch' | 'delete', string][] = [
    ['get', '/promotions'],
    ['post', '/promotions'],
    ['patch', `/promotions/${SOME_ID}`],
    ['patch', `/promotions/${SOME_ID}/enabled`],
    ['delete', `/promotions/${SOME_ID}`],
  ];

  describe('permisos (CA7)', () => {
    it.each(ENDPOINTS)('%s %s sin token responde 401', async (method, url) => {
      await request(app.getHttpServer())[method](url).expect(401);
    });

    it.each(ENDPOINTS)(
      '%s %s con un Empleado responde 403',
      async (method, url) => {
        await request(app.getHttpServer())
          [method](url)
          .set('Authorization', bearer(employee.accessToken))
          .send(body)
          .expect(403);
      },
    );
  });

  describe('validación', () => {
    it.each([
      [{ title: '   ' }, 'El título no puede estar vacío'],
      [{ discountPercentage: 0 }, 'El descuento debe ser de al menos 1%'],
      [{ discountPercentage: 100 }, 'El descuento no puede superar 99%'],
      [
        { startDate: '01-01-2099' },
        'startDate debe tener el formato YYYY-MM-DD',
      ],
      [{ target: 'RESTAURANT' }, 'La promoción debe aplicar a ROOMS o SPA'],
      [{ minNights: 0 }, 'La cantidad mínima de noches debe ser al menos 1'],
    ])('rechaza %j', async (override, message) => {
      const response = await asAdmin('post', '/promotions')
        .send({ ...body, ...override })
        .expect(400);

      expect(response.body.message).toBe(message);
    });

    it('rechaza un fin anterior al inicio', async () => {
      const response = await asAdmin('post', '/promotions')
        .send({ ...body, endDate: '2098-12-31' })
        .expect(400);

      expect(response.body.message).toMatch(/anterior/);
    });

    it('rechaza un estado que no existe en el filtro', async () => {
      await asAdmin('get', '/promotions?status=VIP').expect(400);
    });
  });

  it('el Administrador crea, edita, deshabilita y elimina (CA1 a CA3)', async () => {
    const created = await asAdmin('post', '/promotions').send(body).expect(201);
    createdIds.push(created.body.id);
    expect(created.body).toMatchObject({
      ...body,
      enabled: true,
      status: 'SCHEDULED',
    });

    const edited = await asAdmin('patch', `/promotions/${created.body.id}`)
      .send({ ...body, title: 'Editada e2e', minNights: null })
      .expect(200);
    expect(edited.body).toMatchObject({
      title: 'Editada e2e',
      minNights: null,
    });

    const disabled = await asAdmin(
      'patch',
      `/promotions/${created.body.id}/enabled`,
    )
      .send({ enabled: false })
      .expect(200);
    expect(disabled.body.status).toBe('DISABLED');

    const list = await asAdmin('get', '/promotions?status=DISABLED').expect(
      200,
    );
    expect(
      list.body.data.map((promotion: { id: string }) => promotion.id),
    ).toContain(created.body.id);

    await asAdmin('delete', `/promotions/${created.body.id}`).expect(204);
    await asAdmin('delete', `/promotions/${created.body.id}`).expect(404);
  });
});
