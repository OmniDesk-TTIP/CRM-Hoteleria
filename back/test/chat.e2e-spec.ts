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
import { ChatSession, ChatSessionStatus, HandoverReason } from '../src/infrastructure/database/entities/ChatSession.entity';
import { ChatMessage, MessageRole } from '../src/infrastructure/database/entities/ChatMessage.entity';
import { RELEASE_NOTICE, takeOverGreeting } from '../src/modules/chat/chat.service';

const UNKNOWN_UUID = '11111111-2222-4333-8444-555555555555';

describe('Chats / Handover (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const botMock = {
    launch: jest.fn(),
    stop: jest.fn(),
    on: jest.fn(),
    start: jest.fn(),
    use: jest.fn(),
    telegram: { sendMessage: jest.fn().mockResolvedValue(undefined) },
  };

  // Un huésped por escenario: las suites comparten base y el unique de chat_sessions no perdona.
  const suffix = Date.now().toString().slice(-6);
  const guestWithHistory = `70${suffix}`;
  const guestPendingHandover = `71${suffix}`;
  const guestTakenOver = `72${suffix}`;
  const telegramUserIds = [guestWithHistory, guestPendingHandover, guestTakenOver];

  let chatWithHistoryId: string;
  let chatPendingHandoverId: string;
  let chatTakenOverId: string;

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
      .useValue(botMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);

    const withHistory = em.create(ChatSession, { telegramUserId: guestWithHistory, guestDisplayName: 'Ana Gómez' });
    const pending = em.create(ChatSession, {
      telegramUserId: guestPendingHandover,
      status: ChatSessionStatus.WAITING_HUMAN,
      handoverRequestedAt: new Date('2026-09-21T09:00:00Z'),
      handoverReason: HandoverReason.GUEST_REQUEST,
      unreadCount: 3,
    });
    const takenOver = em.create(ChatSession, {
      telegramUserId: guestTakenOver,
      status: ChatSessionStatus.HUMAN,
    });

    // Tres mensajes con createdAt explícito para que la paginación por cursor sea determinista.
    em.create(ChatMessage, { telegramUserId: guestWithHistory, role: MessageRole.USER, content: 'Hola, ¿tienen lugar?', createdAt: new Date('2026-09-21T10:00:00Z') });
    em.create(ChatMessage, { telegramUserId: guestWithHistory, role: MessageRole.BOT, content: '¡Hola! ¿Para qué fechas?', createdAt: new Date('2026-09-21T11:00:00Z') });
    em.create(ChatMessage, { telegramUserId: guestWithHistory, role: MessageRole.USER, content: 'Del 10 al 12', createdAt: new Date('2026-09-21T12:00:00Z') });

    await em.flush();

    chatWithHistoryId = withHistory.id;
    chatPendingHandoverId = pending.id;
    chatTakenOverId = takenOver.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(ChatMessage, { telegramUserId: { $in: telegramUserIds } });
      await em.nativeDelete(ChatSession, { telegramUserId: { $in: telegramUserIds } });
      await em.nativeDelete(User, { email: { $in: [admin.user.email, employee.user.email] } });
    } catch (e) {
    } finally {
      // Fuera del try a propósito: si la limpieza falla, cerrar igual la app. Si no, el servidor
      // de socket.io y el pool de la base quedan vivos y jest no termina nunca.
      if (app) await app.close();
    }
  });

  beforeEach(() => {
    botMock.telegram.sendMessage.mockClear();
    botMock.telegram.sendMessage.mockResolvedValue(undefined);
  });

  describe('Autenticación', () => {
    it.each([
      ['get', '/chats'],
      ['get', `/chats/${UNKNOWN_UUID}`],
      ['get', `/chats/${UNKNOWN_UUID}/messages`],
      ['post', `/chats/${UNKNOWN_UUID}/messages`],
      ['post', `/chats/${UNKNOWN_UUID}/takeover`],
      ['post', `/chats/${UNKNOWN_UUID}/release`],
      ['post', `/chats/${UNKNOWN_UUID}/read`],
    ])('%s %s sin token responde 401', async (method, url) => {
      await (request(app.getHttpServer()) as any)[method](url).expect(401);
    });

    it('un empleado también puede atender chats (no solo Administrador)', async () => {
      await request(app.getHttpServer())
        .get('/chats')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);
    });
  });

  describe('GET /chats', () => {
    it('devuelve la bandeja paginada', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/chats')
        .query({ pageSize: 50 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(body).toMatchObject({ page: 1, pageSize: 50 });
      const ids = body.data.map((chat: any) => chat.id);
      expect(ids).toEqual(expect.arrayContaining([chatWithHistoryId, chatPendingHandoverId, chatTakenOverId]));
    });

    it('filtra por estado', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/chats')
        .query({ status: ChatSessionStatus.WAITING_HUMAN, pageSize: 50 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      const ids = body.data.map((chat: any) => chat.id);
      expect(ids).toContain(chatPendingHandoverId);
      expect(ids).not.toContain(chatWithHistoryId);
    });

    it('filtra las que esperan intervención', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/chats')
        .query({ pendingHandover: 'true', pageSize: 50 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      const ids = body.data.map((chat: any) => chat.id);
      expect(ids).toContain(chatPendingHandoverId);
      expect(ids).not.toContain(chatWithHistoryId);
    });

    it('busca por nombre del huésped', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/chats')
        .query({ search: 'ana gó', pageSize: 50 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(body.data.map((chat: any) => chat.id)).toContain(chatWithHistoryId);
    });

    it('rechaza un pageSize mayor al permitido', async () => {
      await request(app.getHttpServer())
        .get('/chats')
        .query({ pageSize: 500 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);
    });
  });

  describe('GET /chats/:chatId', () => {
    it('devuelve el detalle con el proceso de reserva activo', async () => {
      const { body } = await request(app.getHttpServer())
        .get(`/chats/${chatWithHistoryId}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(body).toMatchObject({
        id: chatWithHistoryId,
        telegramUserId: guestWithHistory,
        status: ChatSessionStatus.BOT,
        activeBooking: null,
      });
    });

    it('400 si el id no es un uuid y 404 si no existe', async () => {
      await request(app.getHttpServer())
        .get('/chats/no-es-un-uuid')
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);

      await request(app.getHttpServer())
        .get(`/chats/${UNKNOWN_UUID}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(404);
    });
  });

  describe('GET /chats/:chatId/messages (CA3)', () => {
    it('pagina por cursor sin solapamientos ni huecos', async () => {
      const first = await request(app.getHttpServer())
        .get(`/chats/${chatWithHistoryId}/messages`)
        .query({ limit: 2 })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      // Orden cronológico inverso: lo último dicho primero.
      expect(first.body.data.map((m: any) => m.content)).toEqual(['Del 10 al 12', '¡Hola! ¿Para qué fechas?']);
      expect(first.body.nextCursor).toBeTruthy();

      const second = await request(app.getHttpServer())
        .get(`/chats/${chatWithHistoryId}/messages`)
        .query({ limit: 2, before: first.body.nextCursor })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(second.body.data.map((m: any) => m.content)).toEqual(['Hola, ¿tienen lugar?']);
      expect(second.body.nextCursor).toBeNull();
    });

    it('rechaza un cursor que no es una fecha', async () => {
      await request(app.getHttpServer())
        .get(`/chats/${chatWithHistoryId}/messages`)
        .query({ before: 'ayer' })
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);
    });
  });

  describe('POST /chats/:chatId/messages (CA3)', () => {
    it('entrega el mensaje al huésped y lo guarda con el operador que lo escribió', async () => {
      const { body } = await request(app.getHttpServer())
        .post(`/chats/${chatTakenOverId}/messages`)
        .set('Authorization', bearer(employee.accessToken))
        .send({ text: 'Hola, soy Lucrecia de recepción' })
        .expect(201);

      expect(body).toMatchObject({
        role: MessageRole.OPERATOR,
        content: 'Hola, soy Lucrecia de recepción',
        sentBy: { id: employee.user.id, fullName: employee.user.fullName },
      });

      // Sin parse_mode y con el texto crudo: dos argumentos, ni uno más.
      expect(botMock.telegram.sendMessage).toHaveBeenCalledWith(guestTakenOver, 'Hola, soy Lucrecia de recepción');
      expect(botMock.telegram.sendMessage.mock.calls[0]).toHaveLength(2);
    });

    it('409 si nadie tomó el control: escribir ya no lo toma de forma implícita', async () => {
      await request(app.getHttpServer())
        .post(`/chats/${chatWithHistoryId}/messages`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ text: 'Te ayudo yo con eso' })
        .expect(409);

      expect(botMock.telegram.sendMessage).not.toHaveBeenCalled();

      const { body } = await request(app.getHttpServer())
        .get(`/chats/${chatWithHistoryId}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(body.status).toBe(ChatSessionStatus.BOT);
    });

    it('502 si Telegram rechaza el mensaje, y no lo guarda', async () => {
      botMock.telegram.sendMessage.mockRejectedValueOnce(new Error('403: bot was blocked by the user'));

      await request(app.getHttpServer())
        .post(`/chats/${chatTakenOverId}/messages`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ text: 'Mensaje que no llega' })
        .expect(502);

      const saved = await em.fork().find(ChatMessage, { telegramUserId: guestTakenOver, content: 'Mensaje que no llega' });
      expect(saved).toHaveLength(0);
    });

    it.each([
      ['vacío', { text: '' }],
      ['solo espacios', { text: '   ' }],
      ['con un campo de más', { text: 'Hola', prioridad: 'alta' }],
      ['más largo que el límite de Telegram', { text: 'a'.repeat(4001) }],
    ])('400 si el body viene %s', async (_caso, payload) => {
      await request(app.getHttpServer())
        .post(`/chats/${chatTakenOverId}/messages`)
        .set('Authorization', bearer(admin.accessToken))
        .send(payload)
        .expect(400);
    });
  });

  describe('takeover y release (CA2 y CA4)', () => {
    it('toma el control, silencia al bot y apaga la bandera de intervención', async () => {
      const { body } = await request(app.getHttpServer())
        .post(`/chats/${chatPendingHandoverId}/takeover`)
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      expect(body).toMatchObject({
        status: ChatSessionStatus.HUMAN,
        assignedOperator: { id: employee.user.id },
        handoverRequestedAt: null,
      });
      expect(body.guestNotified).toBe(true);
      // El huésped se entera de que ahora lo atiende una persona.
      const greeting = takeOverGreeting(employee.user.fullName);
      expect(botMock.telegram.sendMessage).toHaveBeenCalledWith(guestPendingHandover, greeting);

      const saved = await em.fork().find(ChatMessage, { telegramUserId: guestPendingHandover, content: greeting });
      expect(saved).toHaveLength(1);
      expect(saved[0].role).toBe(MessageRole.OPERATOR);
    });

    it('CA4: devolver el control reactiva al bot y avisa al huésped', async () => {
      const { body } = await request(app.getHttpServer())
        .post(`/chats/${chatPendingHandoverId}/release`)
        .set('Authorization', bearer(employee.accessToken))
        .send({})
        .expect(200);

      expect(body).toMatchObject({
        status: ChatSessionStatus.BOT,
        assignedOperator: null,
        consecutiveBotFailures: 0,
        guestNotified: true,
      });
      expect(botMock.telegram.sendMessage).toHaveBeenCalledWith(guestPendingHandover, RELEASE_NOTICE);

      // Lo de arriba sale de la entidad en memoria. Esto comprueba que la columna quedó en NULL:
      // MikroORM solo escribe NULL si el valor es estrictamente null, nunca con undefined.
      const persisted = await em.fork().findOne(ChatSession, { id: chatPendingHandoverId });
      expect(persisted?.assignedOperator).toBeNull();
      expect(persisted?.status).toBe(ChatSessionStatus.BOT);
      expect(persisted?.releasedAt).toBeInstanceOf(Date);
    });

    it('si Telegram falla al avisar, el chat igual vuelve al bot', async () => {
      await request(app.getHttpServer())
        .post(`/chats/${chatTakenOverId}/takeover`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      botMock.telegram.sendMessage.mockRejectedValueOnce(new Error('timeout'));

      const { body } = await request(app.getHttpServer())
        .post(`/chats/${chatTakenOverId}/release`)
        .set('Authorization', bearer(admin.accessToken))
        .send({})
        .expect(200);

      expect(body).toMatchObject({ status: ChatSessionStatus.BOT, guestNotified: false });
    });

    it('rechaza un closeActiveBooking que no sea booleano', async () => {
      await request(app.getHttpServer())
        .post(`/chats/${chatTakenOverId}/release`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ closeActiveBooking: 'sí' })
        .expect(400);
    });
  });

  describe('POST /chats/:chatId/read', () => {
    it('deja los no leídos en cero', async () => {
      await request(app.getHttpServer())
        .post(`/chats/${chatPendingHandoverId}/read`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(200, { unreadCount: 0 });

      const { body } = await request(app.getHttpServer())
        .get(`/chats/${chatPendingHandoverId}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(body.unreadCount).toBe(0);
    });
  });
});
