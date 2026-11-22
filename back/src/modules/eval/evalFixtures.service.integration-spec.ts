import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { AccountService } from '../account/account.service';
import { EvalFixturesService } from './evalFixtures.service';
import { toDateKey, zonedDateKey } from '../../common/date.util';
import { Account } from '../../infrastructure/database/entities/Account.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { User } from '../../infrastructure/database/entities/User.entity';

/**
 * US-27: la estadía que arman las evals para un huésped alojado, contra la base de test. El
 * EvalModule solo se carga con EVAL_API_KEY, así que el servicio se instancia a mano.
 */
describe('EvalFixturesService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let fixtures: EvalFixturesService;
  let accounts: AccountService;

  const suffix = Date.now();
  // 15/03/2099 a las 01:00 en Buenos Aires: en UTC ya es otro día (04:00), y la estadía tiene
  // que tomar "hoy" en la zona del hotel
  const NOW = new Date(Date.UTC(2099, 2, 15, 4, 0));
  const TODAY = '2099-03-15';

  let categoryId: string;
  let roomId: string;
  let userId: string;
  const telegramUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ ingestDocument: jest.fn(), askQuestion: jest.fn() })
      .overrideProvider(PaymentService)
      .useValue({})
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
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    accounts = app.get(AccountService);
    fixtures = new EvalFixturesService(orm.em, accounts, {
      get: () => 'America/Argentina/Buenos_Aires',
    } as never);

    // el fixture usa la primera habitación activa: se asegura que haya una
    const category = em.create(RoomCategory, {
      name: `Cat eval ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `EVAL-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    const user = em.create(User, {
      email: `eval-fixtures-${suffix}@test.local`,
      passwordHash: 'hash',
      fullName: 'Admin Eval',
    });
    em.persist([category, room, user]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
    userId = user.id;
  });

  afterAll(async () => {
    try {
      const reservations = await em.find(Reservation, {
        telegramUserId: { $in: telegramUserIds },
      });
      const reservationIds = reservations.map((row) => row.id);
      await em.nativeDelete(Account, { reservation: { $in: reservationIds } });
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, { id: userId });
    } finally {
      await app.close();
    }
  });

  const newGuest = () => {
    const telegramUserId = `eval-fixture-${suffix}-${telegramUserIds.length}`;
    telegramUserIds.push(telegramUserId);
    return telegramUserId;
  };

  it('crea una estadía confirmada que incluye hoy en la zona del hotel, sin cuenta', async () => {
    const telegramUserId = newGuest();

    const reservationId = await fixtures.seedStay(telegramUserId, false, NOW);

    const reservation = await em
      .fork()
      .findOneOrFail(Reservation, { id: reservationId });
    expect(reservation).toMatchObject({
      telegramUserId,
      status: ReservationStatus.CONFIRMED,
    });
    expect(toDateKey(reservation.checkIn) < TODAY).toBe(true);
    expect(toDateKey(reservation.checkOut) > TODAY).toBe(true);
    expect(zonedDateKey(NOW, 'America/Argentina/Buenos_Aires')).toBe(TODAY);
    expect(await accounts.hasOpenAccount(reservationId)).toBe(false);
  });

  it('con cuenta, la deja abierta y en cero', async () => {
    const reservationId = await fixtures.seedStay(newGuest(), true, NOW);

    const { account } = await accounts.getForReservation(reservationId);

    expect(account).toMatchObject({ status: 'OPEN', balance: 0 });
  });
});
