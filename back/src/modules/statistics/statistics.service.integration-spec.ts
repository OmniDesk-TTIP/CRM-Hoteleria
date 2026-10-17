import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { StatisticsService } from './statistics.service';
import {
  RefundStatus,
  Reservation,
  ReservationOrigin,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';

describe('StatisticsService (integración)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let service: StatisticsService;

  const suffix = Date.now();
  let categoryId: string;
  let roomId: string;

  const NOW = new Date('2150-10-02T01:00:00Z');
  const at = (iso: string) => new Date(`2150-${iso}Z`);

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
    await app.init();

    em = app.get(MikroORM).em.fork();
    service = app.get(StatisticsService);

    const category = em.create(RoomCategory, {
      name: `Stats integración ${suffix}`,
      capacity: 2,
      basePrice: 20000,
    });
    const room = em.create(Room, {
      roomNumber: `STI-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });

    const reservation = (data: {
      createdAt: Date;
      origin?: ReservationOrigin;
      status?: ReservationStatus;
      totalAmount?: number;
      depositAmount: number;
      cancelledAt?: Date;
      refundAmount?: number;
      refundStatus?: RefundStatus;
    }) =>
      em.create(Reservation, {
        room,
        checkIn: new Date('2151-01-10'),
        checkOut: new Date('2151-01-12'),
        guestFullName: 'Huésped Stats',
        guestDni: '20111222',
        status: ReservationStatus.CONFIRMED,
        totalAmount: 100000,
        ...data,
      });

    reservation({
      createdAt: at('10-01T03:00:00'),
      origin: ReservationOrigin.BOT,
      depositAmount: 30000,
    });
    reservation({
      createdAt: at('10-01T20:00:00'),
      origin: ReservationOrigin.BOT,
      totalAmount: 80000,
      depositAmount: 24000,
    });
    reservation({
      createdAt: at('10-01T21:00:00'),
      origin: ReservationOrigin.MANUAL,
      depositAmount: 15000,
    });
    reservation({
      createdAt: at('10-01T02:59:00'),
      origin: ReservationOrigin.BOT,
      depositAmount: 30000,
    });
    reservation({
      createdAt: at('09-25T02:59:00'),
      origin: ReservationOrigin.MANUAL,
      depositAmount: 30000,
    });

    reservation({
      createdAt: at('09-01T12:00:00'),
      status: ReservationStatus.CANCELLED,
      depositAmount: 30000,
      cancelledAt: at('10-01T10:00:00'),
      refundAmount: 15000,
      refundStatus: RefundStatus.PENDING,
    });
    reservation({
      createdAt: at('10-01T05:00:00'),
      status: ReservationStatus.CANCELLED,
      depositAmount: 30000,
      cancelledAt: at('10-01T11:00:00'),
      refundAmount: 30000,
      refundStatus: RefundStatus.COMPLETED,
    });
    reservation({
      createdAt: at('09-20T12:00:00'),
      status: ReservationStatus.CANCELLED,
      depositAmount: 20000,
      cancelledAt: at('09-30T12:00:00'),
      refundAmount: 5000,
      refundStatus: RefundStatus.PENDING,
    });

    const session = (
      id: string,
      createdAt: Date,
      extra: Partial<Pick<ChatSession, 'takenOverAt' | 'handoverRequestedAt'>>,
    ) =>
      em.create(ChatSession, {
        telegramUserId: `stats-int-${suffix}-${id}`,
        createdAt,
        ...extra,
      });

    session('a', at('10-01T04:00:00'), { takenOverAt: at('10-01T04:10:00') });
    session('b', at('10-01T05:00:00'), {
      handoverRequestedAt: at('10-01T05:10:00'),
    });
    session('c', at('10-01T06:00:00'), {});
    session('d', at('10-01T07:00:00'), {});
    session('e', at('09-30T12:00:00'), { takenOverAt: at('09-30T12:10:00') });

    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  afterAll(async () => {
    try {
      if (roomId) {
        await em.nativeDelete(Reservation, { room: roomId });
        await em.nativeDelete(Room, { id: roomId });
      }
      if (categoryId) {
        await em.nativeDelete(RoomCategory, { id: categoryId });
      }
      await em.nativeDelete(ChatSession, {
        telegramUserId: { $like: `stats-int-${suffix}-%` },
      });
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  it('"este mes" arranca a las 00:00 del día 1 en hora del hotel', async () => {
    const stats = await service.getStatistics('month', NOW);

    expect(stats).toEqual({
      range: 'month',
      from: '2150-10-01',
      sales: { total: 3, bot: 2, manual: 1, botPct: 66.7, manualPct: 33.3 },
      revenue: {
        botDeposits: 54000,
        botTotalValue: 180000,
        cancellationRetained: 15000,
        refundsPending: 15000,
        refundsCompleted: 30000,
      },
      handover: { totalSessions: 4, handedOver: 2, ratePct: 50 },
    });
  });

  it('"últimos 7 días" incluye hoy y los 6 días anteriores en hora del hotel', async () => {
    const stats = await service.getStatistics('7d', NOW);

    expect(stats).toEqual({
      range: '7d',
      from: '2150-09-25',
      sales: { total: 4, bot: 3, manual: 1, botPct: 75, manualPct: 25 },
      revenue: {
        botDeposits: 84000,
        botTotalValue: 280000,
        cancellationRetained: 30000,
        refundsPending: 20000,
        refundsCompleted: 30000,
      },
      handover: { totalSessions: 5, handedOver: 3, ratePct: 60 },
    });
  });

  it('"este mes" no se adelanta al mes siguiente por la diferencia con UTC', async () => {
    const stats = await service.getStatistics('month', at('10-01T02:00:00'));

    expect(stats.from).toBe('2150-09-01');
  });

  it('un período sin datos devuelve todo en cero, sin NaN', async () => {
    const stats = await service.getStatistics(
      'month',
      new Date('2151-06-15T12:00:00Z'),
    );

    expect(stats).toEqual({
      range: 'month',
      from: '2151-06-01',
      sales: { total: 0, bot: 0, manual: 0, botPct: 0, manualPct: 0 },
      revenue: {
        botDeposits: 0,
        botTotalValue: 0,
        cancellationRetained: 0,
        refundsPending: 0,
        refundsCompleted: 0,
      },
      handover: { totalSessions: 0, handedOver: 0, ratePct: 0 },
    });
  });
});
