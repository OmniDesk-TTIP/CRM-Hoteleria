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
import { RefreshToken } from '../src/infrastructure/database/entities/RefreshToken.entity';

const REFRESH_COOKIE = 'refresh_token';

/** Saca el valor de la cookie de refresh del header Set-Cookie de una respuesta. */
const extractRefreshCookie = (res: request.Response): string => {
  const header = res.headers['set-cookie'] as unknown as string[];
  const cookie = header?.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));

  if (!cookie) throw new Error('La respuesta no trajo la cookie de refresh');

  return cookie.split(';')[0];
};

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;
  const createdEmails: string[] = [];

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
    // createNestApplication() no ejecuta main.ts: hay que replicar a mano el pipe y el
    // cookie-parser, o /auth/refresh nunca ve la cookie y devuelve 401 siempre.
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);
  });

  afterAll(async () => {
    try {
      // Los refresh tokens tienen FK al usuario: se borran primero.
      await em.nativeDelete(RefreshToken, {});
      await em.nativeDelete(User, { email: { $in: [admin.user.email, employee.user.email, ...createdEmails] } });
      if (app) await app.close();
    } catch (e) {
    }
  });

  describe('POST /auth/login', () => {
    it('devuelve el access token, el usuario y la cookie httpOnly del refresh', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: admin.user.email, password: admin.password })
        .expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.user.email).toBe(admin.user.email);
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');

      const cookie = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith(`${REFRESH_COOKIE}=`),
      );
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/auth');
    });

    it('acepta el email con otra capitalización', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: admin.user.email.toUpperCase(), password: admin.password })
        .expect(200);
    });

    it('no permite distinguir un email inexistente de una contraseña incorrecta', async () => {
      const inexistente = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nadie@omnidesk.test', password: 'unaClaveLarga123' })
        .expect(401);

      const claveMala = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: admin.user.email, password: 'claveIncorrecta' })
        .expect(401);

      expect(inexistente.body.message).toBe(claveMala.body.message);
    });

    it('rechaza un email mal formado con un mensaje en español (400)', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'no-es-un-email', password: 'unaClaveLarga123' })
        .expect(400);

      expect(response.body.message).toContain('email válido');
    });

    it('rechaza campos no declarados en el DTO (400)', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: admin.user.email, password: admin.password, rememberMe: true })
        .expect(400);
    });
  });

  describe('GET /auth/me', () => {
    it('rechaza sin header Authorization (401)', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rechaza un token inválido (401)', async () => {
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer basura').expect(401);
    });

    it('devuelve el usuario autenticado sin el hash de la contraseña', async () => {
      const response = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      expect(response.body.email).toBe(employee.user.email);
      expect(response.body.role).toBe(UserRole.EMPLOYEE);
      expect(response.body).not.toHaveProperty('passwordHash');
    });
  });

  describe('POST /auth/register', () => {
    it('rechaza sin token (401)', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'nueva@omnidesk.test', password: 'unaClaveLarga123', fullName: 'Nueva Empleada' })
        .expect(401);
    });

    it('rechaza a un EMPLOYEE (403)', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .set('Authorization', bearer(employee.accessToken))
        .send({ email: 'nueva@omnidesk.test', password: 'unaClaveLarga123', fullName: 'Nueva Empleada' })
        .expect(403);
    });

    it('permite a un ADMIN crear un empleado (201)', async () => {
      const email = `nueva-${Date.now()}@omnidesk.test`;
      createdEmails.push(email);

      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .set('Authorization', bearer(admin.accessToken))
        .send({ email, password: 'unaClaveLarga123', fullName: 'Nueva Empleada' })
        .expect(201);

      expect(response.body.role).toBe(UserRole.EMPLOYEE);
      expect(response.body).not.toHaveProperty('passwordHash');

      // El usuario recién creado tiene que poder loguearse.
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'unaClaveLarga123' })
        .expect(200);
    });

    it('rechaza un email ya registrado (409)', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .set('Authorization', bearer(admin.accessToken))
        .send({ email: admin.user.email, password: 'unaClaveLarga123', fullName: 'Duplicada' })
        .expect(409);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rechaza cuando no hay cookie (401)', async () => {
      await request(app.getHttpServer()).post('/auth/refresh').expect(401);
    });

    it('rota el par de tokens y deja inservible la cookie anterior', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: employee.user.email, password: employee.password })
        .expect(200);

      const primeraCookie = extractRefreshCookie(login);

      const refresh = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', primeraCookie)
        .expect(200);

      const segundaCookie = extractRefreshCookie(refresh);
      expect(refresh.body.accessToken).toEqual(expect.any(String));
      expect(segundaCookie).not.toBe(primeraCookie);

      // Reusar la cookie vieja es la señal de token robado: se cierran TODAS las sesiones,
      // así que la cookie nueva también deja de servir.
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', primeraCookie).expect(401);
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', segundaCookie).expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revoca la sesión y deja la cookie inutilizable', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: employee.user.email, password: employee.password })
        .expect(200);

      const cookie = extractRefreshCookie(login);

      await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(204);
      await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
    });

    it('sin cookie responde 204 igual', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(204);
    });

    it('cerrar sesión en un dispositivo no afecta a los otros', async () => {
      const lobby = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: employee.user.email, password: employee.password })
        .expect(200);

      const backOffice = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: employee.user.email, password: employee.password })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', extractRefreshCookie(lobby))
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', extractRefreshCookie(backOffice))
        .expect(200);
    });
  });

  // El guard es global (APP_GUARD): lo que antes era público tiene que seguir siéndolo.
  // Si esto se rompe, Mercado Pago deja de poder confirmar reservas.
  describe('Regresión: endpoints públicos tras el guard global', () => {
    it('GET / sigue abierto', async () => {
      await request(app.getHttpServer()).get('/').expect(200);
    });

    it('POST /payment/webhook llega al handler sin token', async () => {
      const response = await request(app.getHttpServer())
        .post('/payment/webhook')
        .send({ type: 'payment', data: { id: '123' } });

      expect(response.status).not.toBe(401);
    });

    it('GET /payment/:id/summary responde sin token (404 por reserva inexistente, no 401)', async () => {
      await request(app.getHttpServer())
        .get('/payment/00000000-0000-0000-0000-000000000000/summary')
        .expect(404);
    });

    it('POST /rag/ask sigue abierto para el bot', async () => {
      await request(app.getHttpServer())
        .post('/rag/ask')
        .send({ question: '¿Cuáles son los horarios del hotel?' })
        .expect(200);
    });

    it('POST /rag/ingest ahora exige un ADMIN', async () => {
      await request(app.getHttpServer())
        .post('/rag/ingest')
        .send({ text: 'un texto suficientemente largo' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/rag/ingest')
        .set('Authorization', bearer(employee.accessToken))
        .send({ text: 'un texto suficientemente largo' })
        .expect(403);
    });
  });
});
