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
import { Room } from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationOrigin,
  ReservationStatus,
} from '../src/infrastructure/database/entities/Reservation.entity';
import {
  ChatSession,
  ChatSessionStatus,
} from '../src/infrastructure/database/entities/ChatSession.entity';

interface StatsBody {
  range: string;
  from: string | null;
  sales: { total: number; bot: number; manual: number };
  revenue: { botDeposits: number; botTotalValue: number };
  handover: { totalSessions: number; handedOver: number; ratePct: number };
}

describe('Statistics (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  let categoryId: string;
  let roomId: string;

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
      // Con `roomId` sin definir (si el test falló antes de crear la habitación) el filtro
      // quedaría vacío y borraría de más: solo se limpia lo que esta suite llegó a crear.
      if (roomId) {
        await em.nativeDelete(Reservation, { room: roomId });
        await em.nativeDelete(Room, { id: roomId });
      }
      if (categoryId) {
        await em.nativeDelete(RoomCategory, { id: categoryId });
      }
      await em.nativeDelete(ChatSession, {
        telegramUserId: { $like: `stats-e2e-${suffix}-%` },
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

  const getStats = (query = '') =>
    request(app.getHttpServer())
      .get(`/statistics${query}`)
      .set('Authorization', bearer(admin.accessToken));

  describe('Autorización', () => {
    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/statistics').expect(401);
    });

    it('un empleado recibe 403: solo los Administradores ven las métricas', async () => {
      await request(app.getHttpServer())
        .get('/statistics')
        .set('Authorization', bearer(employee.accessToken))
        .expect(403);
    });
  });

  describe('Validación', () => {
    it('un range inválido responde 400', async () => {
      await getStats('?range=ayer').expect(400);
    });

    it('sin range usa "month"', async () => {
      const { body } = await getStats().expect(200);
      expect((body as StatsBody).range).toBe('month');
    });
  });

  describe('Resultado', () => {
    it('responde la forma esperada para cada período (también valida el SQL contra la base)', async () => {
      for (const range of ['month', '7d', 'all']) {
        const { body } = await getStats(`?range=${range}`).expect(200);
        const stats = body as StatsBody;

        expect(stats.range).toBe(range);
        expect(typeof stats.sales.total).toBe('number');
        expect(typeof stats.revenue.botDeposits).toBe('number');
        expect(typeof stats.handover.ratePct).toBe('number');
      }
    });

    it('el histórico no tiene fecha de inicio y los demás sí', async () => {
      const all = (await getStats('?range=all').expect(200)).body as StatsBody;
      const week = (await getStats('?range=7d').expect(200)).body as StatsBody;

      expect(all.from).toBeNull();
      expect(week.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('cuenta reservas confirmadas por origen, la seña del bot y las derivaciones a humano', async () => {
      // La base de test se comparte entre suites: se compara contra una foto previa.
      const before = (await getStats('?range=all').expect(200))
        .body as StatsBody;

      const category = em.create(RoomCategory, {
        name: `Stats E2E-${suffix}`,
        capacity: 2,
        basePrice: 20000,
      });
      const room = em.create(Room, {
        roomNumber: `ST-${suffix}`,
        category,
      });
      const base = {
        room,
        checkIn: new Date('2027-01-10'),
        checkOut: new Date('2027-01-12'),
        guestFullName: 'Huésped Stats',
        guestDni: '20111222',
      };

      em.create(Reservation, {
        ...base,
        status: ReservationStatus.CONFIRMED,
        origin: ReservationOrigin.BOT,
        totalAmount: 100000,
        depositAmount: 30000,
      });
      em.create(Reservation, {
        ...base,
        status: ReservationStatus.CONFIRMED,
        origin: ReservationOrigin.MANUAL,
        totalAmount: 50000,
        depositAmount: 15000,
      });
      // No cuentan: una pendiente de pago y una cancelada.
      em.create(Reservation, {
        ...base,
        status: ReservationStatus.PENDING_PAYMENT,
        origin: ReservationOrigin.BOT,
        totalAmount: 70000,
        depositAmount: 21000,
      });
      em.create(Reservation, {
        ...base,
        status: ReservationStatus.CANCELLED,
        origin: ReservationOrigin.BOT,
        totalAmount: 80000,
        depositAmount: 24000,
      });

      // Una conversación que un operador tomó (y después liberó) y otra que resolvió el bot.
      em.create(ChatSession, {
        telegramUserId: `stats-e2e-${suffix}-a`,
        status: ChatSessionStatus.BOT,
        takenOverAt: new Date(),
        releasedAt: new Date(),
      });
      em.create(ChatSession, {
        telegramUserId: `stats-e2e-${suffix}-b`,
      });

      await em.flush();
      categoryId = category.id;
      roomId = room.id;

      const after = (await getStats('?range=all').expect(200))
        .body as StatsBody;

      expect(after.sales.bot - before.sales.bot).toBe(1);
      expect(after.sales.manual - before.sales.manual).toBe(1);
      expect(after.revenue.botDeposits - before.revenue.botDeposits).toBe(
        30000,
      );
      expect(after.revenue.botTotalValue - before.revenue.botTotalValue).toBe(
        100000,
      );
      expect(after.handover.totalSessions - before.handover.totalSessions).toBe(
        2,
      );
      expect(after.handover.handedOver - before.handover.handedOver).toBe(1);

      // Todo lo recién creado cae dentro de "este mes" y de "últimos 7 días".
      const month = (await getStats('?range=month').expect(200))
        .body as StatsBody;
      expect(month.sales.bot).toBeGreaterThanOrEqual(1);
      expect(month.handover.totalSessions).toBeGreaterThanOrEqual(2);
    });
  });
});
