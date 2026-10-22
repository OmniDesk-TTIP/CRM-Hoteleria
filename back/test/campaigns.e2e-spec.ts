import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { CampaignService } from '../src/modules/campaign/campaign.service';
import { createValidationPipe } from '../src/validation.config';
import { seedUser, bearer } from './auth.helper';
import {
  User,
  UserRole,
} from '../src/infrastructure/database/entities/User.entity';
import { Campaign } from '../src/infrastructure/database/entities/Campaign.entity';
import { ChatSession } from '../src/infrastructure/database/entities/ChatSession.entity';
import { ChatMessage } from '../src/infrastructure/database/entities/ChatMessage.entity';

describe('Campañas (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;
  const sendMessage = jest.fn().mockResolvedValue({});
  const telegramUserId = `tg-campaign-e2e-${Date.now()}`;

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
        telegram: { sendMessage, sendPhoto: jest.fn() },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);

    // Al menos un contacto, para que la campaña tenga a quién mandarse.
    await em.persist(em.create(ChatSession, { telegramUserId })).flush();
  });

  afterAll(async () => {
    try {
      await app.get(CampaignService).whenIdle();
      await em.nativeDelete(Campaign, { createdBy: admin.user.id });
      await em.nativeDelete(ChatMessage, { telegramUserId });
      await em.nativeDelete(ChatSession, { telegramUserId });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  const ENDPOINTS: [string, string][] = [
    ['GET', '/campaigns'],
    ['GET', '/campaigns/recipients-count?audience=ALL'],
    ['POST', '/campaigns'],
  ];

  describe('permisos (CA6)', () => {
    it.each(ENDPOINTS)('%s %s sin token responde 401', async (method, url) => {
      await request(app.getHttpServer())
        [method.toLowerCase() as 'get' | 'post'](url)
        .expect(401);
    });

    it.each(ENDPOINTS)(
      '%s %s con un Empleado responde 403',
      async (method, url) => {
        await request(app.getHttpServer())
          [method.toLowerCase() as 'get' | 'post'](url)
          .set('Authorization', bearer(employee.accessToken))
          .field('title', 'Promo')
          .field('message', 'Hola')
          .field('audience', 'ALL')
          .expect(403);
        expect(sendMessage).not.toHaveBeenCalled();
      },
    );
  });

  describe('vista previa (CA3)', () => {
    it('devuelve cuántos contactos recibirían la campaña', async () => {
      const response = await request(app.getHttpServer())
        .get('/campaigns/recipients-count')
        .query({ audience: 'NO_RESERVATION' })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(response.body.audience).toBe('NO_RESERVATION');
      expect(response.body.count).toBeGreaterThanOrEqual(1);
    });

    it('rechaza destinatarios que no existen', async () => {
      const response = await request(app.getHttpServer())
        .get('/campaigns/recipients-count')
        .query({ audience: 'VIP' })
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);

      expect(response.body.message).toMatch(/destinatarios/i);
    });
  });

  describe('envío', () => {
    it('valida título y mensaje', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', bearer(admin.accessToken))
        .field('title', '   ')
        .field('message', 'Hola')
        .field('audience', 'ALL')
        .expect(400);

      expect(response.body.message).toBe('El título no puede estar vacío');
    });

    it('rechaza una imagen que no es JPG, PNG ni WEBP', async () => {
      await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', bearer(admin.accessToken))
        .field('title', 'Promo')
        .field('message', 'Hola')
        .field('audience', 'ALL')
        .attach('image', Buffer.from('%PDF-1.7'), 'promo.jpg')
        .expect(400);
    });

    it('el Administrador crea la campaña y recibe 202 sin esperar el envío (CA4)', async () => {
      const response = await request(app.getHttpServer())
        .post('/campaigns')
        .set('Authorization', bearer(admin.accessToken))
        .field('title', 'Promo e2e')
        .field('message', 'Hola')
        .field('audience', 'ALL')
        .expect(202);

      expect(response.body).toMatchObject({
        title: 'Promo e2e',
        audience: 'ALL',
        hasImage: false,
        status: 'SENDING',
        sentCount: 0,
      });

      await app.get(CampaignService).whenIdle();
      expect(sendMessage).toHaveBeenCalledWith(
        telegramUserId,
        '<b>Promo e2e</b>\n\nHola',
        { parse_mode: 'HTML' },
      );

      const list = await request(app.getHttpServer())
        .get('/campaigns')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);
      expect(list.body.data[0]).toMatchObject({
        id: response.body.id,
        status: 'COMPLETED',
      });
    });
  });
});
