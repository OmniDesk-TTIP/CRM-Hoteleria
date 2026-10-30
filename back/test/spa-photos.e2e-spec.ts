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
import { SpaPhoto } from '../src/infrastructure/database/entities/SpaPhoto.entity';

// PNG de 1x1: lo mínimo que pasa la detección por contenido.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Spa en la landing y galería (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  const activeName = `Masaje Pub-${suffix}`;
  const inactiveName = `Facial Pub-${suffix}`;
  const photoIds: string[] = [];

  const server = () => app.getHttpServer();
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', bearer(admin.accessToken));
  const getPublicSpa = async () =>
    (await request(server()).get('/public/spa').expect(200)).body as {
      services: { name: string }[];
      photos: { id: string; url: string }[];
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
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);

    // El spa tiene una sola galería: la suite arranca de cero en la base de test.
    await em.nativeDelete(SpaPhoto, {});

    const schedule = {
      availableWeekdays: [1, 2, 3, 4, 5],
      opensAt: '10:00',
      closesAt: '20:00',
    };
    em.create(SpaService, {
      name: activeName,
      description: 'Descontracturante con piedras calientes.',
      durationMinutes: 60,
      price: 25000,
      ...schedule,
    });
    em.create(SpaService, {
      name: inactiveName,
      description: 'Limpieza profunda.',
      durationMinutes: 45,
      price: 18000,
      status: SpaServiceStatus.INACTIVE,
      ...schedule,
    });
    await em.flush();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(SpaPhoto, {});
      await em.nativeDelete(SpaService, {
        name: { $in: [activeName, inactiveName] },
      });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  describe('GET /public/spa', () => {
    it('responde sin token con los servicios activos y sus datos públicos', async () => {
      const spa = await getPublicSpa();

      expect(spa.services.find((s) => s.name === activeName)).toEqual({
        id: expect.any(String),
        name: activeName,
        description: 'Descontracturante con piedras calientes.',
        durationMinutes: 60,
        price: 25000,
        availableWeekdays: [1, 2, 3, 4, 5],
        opensAt: '10:00',
        closesAt: '20:00',
      });
    });

    it('no publica los servicios deshabilitados', async () => {
      const spa = await getPublicSpa();

      expect(spa.services.find((s) => s.name === inactiveName)).toBeUndefined();
    });
  });

  describe('galería', () => {
    it('un empleado puede ver la galería pero no subir fotos', async () => {
      await request(server())
        .get('/spa/photos')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);
      await request(server())
        .post('/spa/photos')
        .set('Authorization', bearer(employee.accessToken))
        .attach('file', PNG_1X1, 'sauna.png')
        .expect(403);
    });

    it('sube fotos al final de la galería', async () => {
      for (let i = 0; i < 2; i++) {
        const response = await asAdmin(request(server()).post('/spa/photos'))
          .attach('file', PNG_1X1, 'sauna.png')
          .expect(201);
        photoIds.push(response.body.id);
        expect(response.body).toMatchObject({
          position: i,
          mimeType: 'image/png',
          url: `/public/spa/photos/${response.body.id}`,
        });
      }
    });

    it('rechaza lo que no es una imagen aunque diga serlo', async () => {
      await asAdmin(request(server()).post('/spa/photos'))
        .attach('file', Buffer.from('<svg onload="alert(1)">'), {
          filename: 'falsa.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('reordena y la landing respeta el orden', async () => {
      const reversed = [...photoIds].reverse();
      await asAdmin(request(server()).put('/spa/photos/order'))
        .send({ ids: reversed })
        .expect(200);

      const spa = await getPublicSpa();
      expect(spa.photos.map((photo) => photo.id)).toEqual(reversed);
    });

    it('rechaza un orden que no incluye todas las fotos', async () => {
      await asAdmin(request(server()).put('/spa/photos/order'))
        .send({ ids: [photoIds[0]] })
        .expect(400);
    });

    it('sirve la imagen sin autenticación', async () => {
      const response = await request(server())
        .get(`/public/spa/photos/${photoIds[0]}`)
        .expect(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(response.body as Buffer, PNG_1X1)).toBe(0);
    });

    it('elimina una foto', async () => {
      await asAdmin(
        request(server()).delete(`/spa/photos/${photoIds[1]}`),
      ).expect(204);
      await request(server())
        .get(`/public/spa/photos/${photoIds[1]}`)
        .expect(404);
    });
  });
});
