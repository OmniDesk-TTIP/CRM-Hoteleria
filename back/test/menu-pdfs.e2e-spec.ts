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
import { RestaurantSettings } from '../src/infrastructure/database/entities/RestaurantSettings.entity';
import { RestaurantMenuItem } from '../src/infrastructure/database/entities/RestaurantMenuItem.entity';
import { SpaService } from '../src/infrastructure/database/entities/SpaService.entity';

describe('Cartas en PDF (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  let spaId: string;

  const server = () => app.getHttpServer();
  const getPdf = (kind: string, accessToken?: string) => {
    const req = request(server()).get(`/menu-pdfs/${kind}`);
    return accessToken ? req.set('Authorization', bearer(accessToken)) : req;
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
        action: jest.fn(),
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

    // El restó es una sola fila y una sola carta: la suite arranca de cero en la base de test.
    await em.nativeDelete(RestaurantSettings, {});
    await em.nativeDelete(RestaurantMenuItem, {});
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(RestaurantSettings, {});
      await em.nativeDelete(RestaurantMenuItem, {});
      await em.nativeDelete(SpaService, { id: spaId });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('quién puede verlas (CA8)', () => {
    it('sin sesión responde 401', async () => {
      await getPdf('restaurant').expect(401);
    });

    it('a un empleado le responde 403', async () => {
      await getPdf('restaurant', employee.accessToken).expect(403);
    });

    it('una carta que no existe responde 400', async () => {
      await getPdf('bar', admin.accessToken).expect(400);
    });
  });

  it('sin ítems habilitados responde 409 con el motivo en vez de un PDF vacío (CA7)', async () => {
    const response = await getPdf('restaurant', admin.accessToken).expect(409);

    expect(response.body.message).toContain('no tiene platos habilitados');
  });

  describe('con la carta cargada (CA8)', () => {
    beforeAll(async () => {
      const settings = em.create(RestaurantSettings, {
        availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
        shifts: [{ opensAt: '12:00', closesAt: '15:00' }],
        roomServiceEnabled: true,
      });
      const dish = em.create(RestaurantMenuItem, {
        name: `Milanesa e2e ${suffix}`,
        category: 'Principales',
        price: 12000,
        availableForRoomService: true,
      });
      const spa = em.create(SpaService, {
        name: `Masaje e2e ${suffix}`,
        description: 'Relajante',
        durationMinutes: 60,
        price: 20000,
        availableWeekdays: [1, 2, 3, 4, 5],
        opensAt: '10:00',
        closesAt: '20:00',
      });
      em.persist([settings, dish, spa]);
      await em.flush();
      spaId = spa.id;
    });

    it.each([
      ['restaurant', 'carta-resto.pdf'],
      ['room-service', 'carta-room-service.pdf'],
      ['spa', 'servicios-spa.pdf'],
    ])(
      'el administrador recibe el PDF de %s para previsualizar o descargar',
      async (kind, filename) => {
        const response = await getPdf(kind, admin.accessToken)
          .responseType('blob')
          .expect(200);

        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['content-disposition']).toBe(
          `inline; filename="${filename}"`,
        );
        expect((response.body as Buffer).subarray(0, 5).toString()).toBe(
          '%PDF-',
        );
      },
    );
  });
});
