import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { AccountService } from '../account/account.service';
import { RestaurantReservationService } from './restaurantReservation.service';
import {
  Account,
  AccountStatus,
  PaymentMethod,
} from '../../infrastructure/database/entities/Account.entity';
import {
  AccountEntry,
  AccountEntryOrigin,
  AccountEntryType,
} from '../../infrastructure/database/entities/AccountEntry.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  RestaurantReservation,
  RestaurantReservationStatus,
} from '../../infrastructure/database/entities/RestaurantReservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { User } from '../../infrastructure/database/entities/User.entity';

/**
 * US-27: carga del ticket del restó a la cuenta, contra la base de test. Las reglas puras están
 * en restaurantReservation.model.spec.ts y los roles en restaurantReservation.controller.spec.ts.
 */
describe('RestaurantReservationService - tickets del restó (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: RestaurantReservationService;
  let accounts: AccountService;

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));

  let categoryId: string;
  let roomId: string;
  let user: User;
  const reservationIds: string[] = [];

  const seedReservation = async () => {
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId: `tg-resto-${next()}`,
      checkIn: new Date(2099, 2, 10, 12),
      checkOut: new Date(2099, 2, 20, 12),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana Restó',
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    reservationIds.push(reservation.id);
    return reservation;
  };

  const seedTable = async (
    reservation: Reservation,
    status = RestaurantReservationStatus.CONFIRMED,
  ) => {
    const table = em.create(RestaurantReservation, {
      status,
      telegramUserId: reservation.telegramUserId!,
      roomReservation: reservation,
      guestFullName: reservation.guestFullName,
      requestedDate: '2099-03-16',
      requestedTime: '21:00',
      partySize: 2,
    });
    em.persist(table);
    await em.flush();
    return table.id;
  };

  /** Huésped con la cuenta abierta y una mesa confirmada. */
  const seedGuestWithTable = async () => {
    const reservation = await seedReservation();
    await accounts.open(reservation.id, PaymentMethod.CASH, user.id, NOW);
    const tableId = await seedTable(reservation);
    return { reservationId: reservation.id, tableId };
  };

  const ticket = (overrides: Record<string, unknown> = {}) => ({
    operationId: randomUUID(),
    amount: 18500.5,
    ticketNumber: '1234',
    detail: 'Cena para 2',
    ...overrides,
  });

  const author = () => ({ userId: user.id });

  const entriesOf = async (reservationId: string): Promise<AccountEntry[]> => {
    const account = await em
      .fork()
      .findOne(Account, { reservation: reservationId });
    return account ? em.fork().find(AccountEntry, { account: account.id }) : [];
  };

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
    service = app.get(RestaurantReservationService);
    accounts = app.get(AccountService);

    const category = em.create(RoomCategory, {
      name: `Cat resto ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `RES-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    user = em.create(User, {
      email: `recepcion-resto-${suffix}@test.local`,
      passwordHash: 'hash',
      fullName: 'Recepción Restó',
    });
    em.persist([category, room, user]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  beforeEach(() => {
    orm.em.clear();
  });

  afterAll(async () => {
    try {
      const rows = await em.find(Account, {
        reservation: { $in: reservationIds },
      });
      const accountIds = rows.map((account) => account.id);
      await em.nativeDelete(AccountEntry, {
        account: { $in: accountIds },
        reverses: { $ne: null },
      });
      await em.nativeDelete(AccountEntry, { account: { $in: accountIds } });
      await em.nativeDelete(Account, { id: { $in: accountIds } });
      await em.nativeDelete(RestaurantReservation, {
        roomReservation: { $in: reservationIds },
      });
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, { id: user.id });
    } finally {
      await app.close();
    }
  });

  describe('carga del ticket', () => {
    it('genera el cargo del restó con el detalle, a nombre del usuario', async () => {
      const { reservationId, tableId } = await seedGuestWithTable();

      const result = await service.chargeTicket(
        tableId,
        ticket(),
        author(),
        NOW,
      );

      expect(result.account?.balance).toBe(18500.5);
      const [charge] = await entriesOf(reservationId);
      expect(charge).toMatchObject({
        type: AccountEntryType.CHARGE,
        origin: AccountEntryOrigin.RESTAURANT,
        sourceId: tableId,
        description: 'Restó: ticket N° 1234 · Cena para 2',
      });
      expect(charge.registeredBy?.id).toBe(user.id);
    });

    it('reintentar con la misma clave no carga otro ticket', async () => {
      const { reservationId, tableId } = await seedGuestWithTable();
      const data = ticket();

      await service.chargeTicket(tableId, data, author(), NOW);
      await service.chargeTicket(tableId, data, author(), NOW);

      expect(await entriesOf(reservationId)).toHaveLength(1);
    });

    it('una misma mesa puede tener varios tickets', async () => {
      const { tableId } = await seedGuestWithTable();

      await service.chargeTicket(tableId, ticket({ amount: 1000 }), author());
      const result = await service.chargeTicket(
        tableId,
        ticket({ amount: 500, ticketNumber: '1235' }),
        author(),
      );

      expect(result.account?.balance).toBe(1500);
    });

    it.each([
      [RestaurantReservationStatus.PENDING],
      [RestaurantReservationStatus.REJECTED],
    ])('rechaza el ticket de una mesa %s', async (status) => {
      const reservation = await seedReservation();
      await accounts.open(reservation.id, PaymentMethod.CASH, user.id, NOW);
      const tableId = await seedTable(reservation, status);

      await expect(
        service.chargeTicket(tableId, ticket(), author(), NOW),
      ).rejects.toThrow(ConflictException);
      expect(await entriesOf(reservation.id)).toHaveLength(0);
    });

    it('sin cuenta abierta no se puede cargar', async () => {
      const reservation = await seedReservation();
      const tableId = await seedTable(reservation);

      await expect(
        service.chargeTicket(tableId, ticket(), author(), NOW),
      ).rejects.toThrow(NotFoundException);
    });

    it('con la cuenta cerrada no se puede cargar', async () => {
      const { reservationId, tableId } = await seedGuestWithTable();
      await em
        .fork()
        .nativeUpdate(
          Account,
          { reservation: reservationId },
          { status: AccountStatus.CLOSED, closedAt: NOW },
        );

      await expect(
        service.chargeTicket(tableId, ticket(), author(), NOW),
      ).rejects.toThrow(ConflictException);
    });

    it('404 si la mesa no existe', async () => {
      await expect(
        service.chargeTicket(randomUUID(), ticket(), author(), NOW),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('anulación del ticket', () => {
    it('anula el cargo con el motivo y el saldo vuelve a cero', async () => {
      const { reservationId, tableId } = await seedGuestWithTable();
      const charged = await service.chargeTicket(
        tableId,
        ticket(),
        author(),
        NOW,
      );
      const chargeId = charged.account!.entries[0].id;

      const result = await service.reverseTicket(
        tableId,
        chargeId,
        'Se cargó a la habitación equivocada',
        author(),
        NOW,
      );

      expect(result.account?.balance).toBe(0);
      const reversal = (await entriesOf(reservationId)).find(
        (entry) => entry.type === AccountEntryType.CHARGE_REVERSAL,
      );
      expect(reversal).toMatchObject({
        description: 'Se cargó a la habitación equivocada',
        origin: AccountEntryOrigin.RESTAURANT,
        sourceId: tableId,
      });
    });

    it('no se anula dos veces', async () => {
      const { tableId } = await seedGuestWithTable();
      const charged = await service.chargeTicket(tableId, ticket(), author());
      const chargeId = charged.account!.entries[0].id;
      await service.reverseTicket(tableId, chargeId, 'Error', author());

      await expect(
        service.reverseTicket(tableId, chargeId, 'Error', author()),
      ).rejects.toThrow(ConflictException);
    });

    it('no anula cargos de otra mesa ni de otro origen', async () => {
      const { reservationId, tableId } = await seedGuestWithTable();
      const reservation = await em
        .fork()
        .findOneOrFail(Reservation, { id: reservationId });
      const otherTableId = await seedTable(reservation);
      const charged = await service.chargeTicket(tableId, ticket(), author());
      const chargeId = charged.account!.entries[0].id;
      const roomServiceCharge = await accounts.registerEntry(
        reservationId,
        {
          type: AccountEntryType.CHARGE,
          amount: 3000,
          description: 'Room service: 2 x Café',
          origin: AccountEntryOrigin.ROOM_SERVICE,
          sourceId: randomUUID(),
        },
        { userId: null },
      );

      await expect(
        service.reverseTicket(otherTableId, chargeId, 'Error', author()),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.reverseTicket(tableId, roomServiceCharge.id, 'Error', author()),
      ).rejects.toThrow(NotFoundException);
    });

    it('exige el motivo', async () => {
      const { tableId } = await seedGuestWithTable();
      const charged = await service.chargeTicket(tableId, ticket(), author());

      await expect(
        service.reverseTicket(
          tableId,
          charged.account!.entries[0].id,
          '   ',
          author(),
        ),
      ).rejects.toThrow(/motivo|descripción/);
    });
  });
});
