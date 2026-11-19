import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { AccountService } from './account.service';
import { ReservationAccountDto } from './dto/account.dto';
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
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import { User } from '../../infrastructure/database/entities/User.entity';

/**
 * US-26 contra la base de test: reservas, cuentas y movimientos son filas reales; Mercado Pago,
 * Gemini y Telegram están simulados. Las reglas puras (saldo, anulaciones) están en
 * account.model.spec.ts; acá se prueba lo que queda persistido y la concurrencia.
 */
describe('AccountService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: AccountService;

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));

  let categoryId: string;
  let roomId: string;
  let user: User;
  const reservationIds: string[] = [];

  const seedReservation = async (status = ReservationStatus.CONFIRMED) => {
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId: `tg-account-${next()}`,
      checkIn: new Date(2099, 2, 10, 12),
      checkOut: new Date(2099, 2, 20, 12),
      status,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana Cuenta',
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    reservationIds.push(reservation.id);
    return reservation.id;
  };

  const seedOpenAccount = async () => {
    const reservationId = await seedReservation();
    await service.open(reservationId, PaymentMethod.CASH, user.id, NOW);
    return reservationId;
  };

  const author = () => ({ userId: user.id });
  const CHAMBER = { userId: null };

  const charge = (amount: number, description = 'Room service') => ({
    type: AccountEntryType.CHARGE as const,
    amount,
    description,
    origin: AccountEntryOrigin.ROOM_SERVICE,
    sourceId: null,
  });

  const accountRow = (reservationId: string) =>
    em.fork().findOne(Account, { reservation: reservationId });

  const entryRows = async (reservationId: string) => {
    const account = await accountRow(reservationId);
    return account
      ? em
          .fork()
          .find(
            AccountEntry,
            { account: account.id },
            { orderBy: { registeredAt: 'asc' } },
          )
      : [];
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
    service = app.get(AccountService);

    const category = em.create(RoomCategory, {
      name: `Cat account ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `ACC-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    user = em.create(User, {
      email: `recepcion-account-${suffix}@test.local`,
      passwordHash: 'hash',
      fullName: 'Lucía Recepción',
    });
    em.persist([category, room, user]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  beforeEach(() => {
    // El service usa el EntityManager global: sin esto podría devolver filas cacheadas de otro test.
    orm.em.clear();
  });

  afterAll(async () => {
    try {
      const accounts = await em.find(Account, {
        reservation: { $in: reservationIds },
      });
      const accountIds = accounts.map((account) => account.id);
      // primero las anulaciones: apuntan a otros movimientos
      await em.nativeDelete(AccountEntry, {
        account: { $in: accountIds },
        reverses: { $ne: null },
      });
      await em.nativeDelete(AccountEntry, { account: { $in: accountIds } });
      await em.nativeDelete(Account, { id: { $in: accountIds } });
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, { id: user.id });
    } finally {
      await app.close();
    }
  });

  describe('apertura', () => {
    it('al registrar el pago del resto de la estadía abre la cuenta en cero', async () => {
      const reservationId = await seedReservation();

      const result = await service.open(
        reservationId,
        PaymentMethod.TRANSFER,
        user.id,
        NOW,
      );

      expect(result.reservation).toMatchObject({
        id: reservationId,
        stayBalance: 70000,
        checkIn: '2099-03-10',
      });
      expect(result.account).toMatchObject({
        status: AccountStatus.OPEN,
        stayBalanceAmount: 70000,
        stayBalancePaymentMethod: PaymentMethod.TRANSFER,
        openedBy: { id: user.id, fullName: 'Lucía Recepción' },
        totalCharges: 0,
        totalPayments: 0,
        balance: 0,
        entries: [],
      });
      const row = await accountRow(reservationId);
      expect(Number(row?.stayBalanceAmount)).toBe(70000);
      expect(row?.openedAt).toEqual(NOW);
    });

    it('una reserva sin cuenta la devuelve en null', async () => {
      const reservationId = await seedReservation();

      const result = await service.getForReservation(reservationId);

      expect(result.account).toBeNull();
      expect(result.reservation.stayBalance).toBe(70000);
    });

    it.each([
      [ReservationStatus.PENDING_PAYMENT],
      [ReservationStatus.CANCELLED],
    ])('no abre la cuenta de una reserva %s', async (status) => {
      const reservationId = await seedReservation(status);

      await expect(
        service.open(reservationId, PaymentMethod.CASH, user.id, NOW),
      ).rejects.toThrow(ConflictException);
      expect(await accountRow(reservationId)).toBeNull();
    });

    it('no abre dos cuentas para la misma reserva, ni a la vez', async () => {
      const reservationId = await seedReservation();

      const results = await Promise.allSettled([
        service.open(reservationId, PaymentMethod.CASH, user.id, NOW),
        service.open(reservationId, PaymentMethod.CARD, user.id, NOW),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(ConflictException);
      expect(
        await em.fork().count(Account, { reservation: reservationId }),
      ).toBe(1);
    });

    it('404 si la reserva no existe', async () => {
      await expect(
        service.getForReservation('00000000-0000-4000-8000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('movimientos', () => {
    it('guarda el movimiento y el saldo sale de los movimientos', async () => {
      const reservationId = await seedOpenAccount();

      await service.registerEntry(
        reservationId,
        charge(5000, '  2 cafés  '),
        author(),
        NOW,
      );
      await service.registerEntry(
        reservationId,
        {
          type: AccountEntryType.PAYMENT,
          amount: 2000,
          description: 'Pago parcial',
          origin: AccountEntryOrigin.RECEPTION,
          paymentMethod: PaymentMethod.CASH,
        },
        author(),
        NOW,
      );

      const { account } = await service.getForReservation(reservationId);
      expect(account).toMatchObject({
        totalCharges: 5000,
        totalPayments: 2000,
        balance: 3000,
      });
      const [first] = await entryRows(reservationId);
      expect(first.description).toBe('2 cafés');
      expect(first.registeredBy?.id).toBe(user.id);
    });

    it('lo que carga Chamber queda sin usuario', async () => {
      const reservationId = await seedOpenAccount();

      await service.registerEntry(
        reservationId,
        { ...charge(1200), origin: AccountEntryOrigin.SPA },
        CHAMBER,
        NOW,
      );

      const { account } = await service.getForReservation(reservationId);
      expect(account?.entries[0]).toMatchObject({
        registeredBy: null,
        origin: AccountEntryOrigin.SPA,
      });
    });

    it('rechaza un monto inválido sin guardar nada', async () => {
      const reservationId = await seedOpenAccount();

      await expect(
        service.registerEntry(reservationId, charge(0), author(), NOW),
      ).rejects.toThrow(BadRequestException);
      expect(await entryRows(reservationId)).toHaveLength(0);
    });

    it('una cuenta cerrada no acepta movimientos', async () => {
      const reservationId = await seedOpenAccount();
      await em
        .fork()
        .nativeUpdate(
          Account,
          { reservation: reservationId },
          { status: AccountStatus.CLOSED, closedAt: NOW },
        );

      await expect(
        service.registerEntry(reservationId, charge(1000), author(), NOW),
      ).rejects.toThrow(ConflictException);
    });

    it('404 si la reserva no tiene cuenta', async () => {
      const reservationId = await seedReservation();

      await expect(
        service.registerEntry(reservationId, charge(1000), author(), NOW),
      ).rejects.toThrow(NotFoundException);
    });

    it('cargas simultáneas no pierden ningún movimiento', async () => {
      const reservationId = await seedOpenAccount();

      await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          service.registerEntry(
            reservationId,
            charge(100 + index),
            author(),
            NOW,
          ),
        ),
      );

      const { account } = await service.getForReservation(reservationId);
      expect(account?.entries).toHaveLength(10);
      expect(account?.balance).toBe(1045);
    });
  });

  describe('anulaciones', () => {
    it('anula un cargo con un movimiento nuevo y el original queda marcado', async () => {
      const reservationId = await seedOpenAccount();
      const original = await service.registerEntry(
        reservationId,
        charge(5000),
        author(),
        NOW,
      );

      const reversal = await service.reverseEntry(
        reservationId,
        original.id,
        'Se cargó a la habitación equivocada',
        author(),
        NOW,
      );

      expect(reversal).toMatchObject({
        type: AccountEntryType.CHARGE_REVERSAL,
        amount: 5000,
        reversesId: original.id,
      });
      const { account } = await service.getForReservation(reservationId);
      expect(account?.balance).toBe(0);
      const entries = account?.entries ?? [];
      expect(entries.find((e) => e.id === original.id)).toMatchObject({
        reversed: true,
        amount: 5000,
      });
    });

    it('no anula dos veces el mismo movimiento, ni a la vez', async () => {
      const reservationId = await seedOpenAccount();
      const original = await service.registerEntry(
        reservationId,
        charge(5000),
        author(),
        NOW,
      );

      const results = await Promise.allSettled([
        service.reverseEntry(
          reservationId,
          original.id,
          'Error',
          author(),
          NOW,
        ),
        service.reverseEntry(
          reservationId,
          original.id,
          'Error',
          author(),
          NOW,
        ),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      await expect(
        service.reverseEntry(reservationId, original.id, 'Otra', author(), NOW),
      ).rejects.toThrow(ConflictException);
      expect(await entryRows(reservationId)).toHaveLength(2);
    });

    it('exige el motivo', async () => {
      const reservationId = await seedOpenAccount();
      const original = await service.registerEntry(
        reservationId,
        charge(5000),
        author(),
        NOW,
      );

      await expect(
        service.reverseEntry(reservationId, original.id, '   ', author(), NOW),
      ).rejects.toThrow(BadRequestException);
    });

    it('no anula un movimiento de otra cuenta', async () => {
      const reservationId = await seedOpenAccount();
      const otherReservationId = await seedOpenAccount();
      const original = await service.registerEntry(
        otherReservationId,
        charge(5000),
        author(),
        NOW,
      );

      await expect(
        service.reverseEntry(
          reservationId,
          original.id,
          'Error',
          author(),
          NOW,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('pagos en recepción (US-28)', () => {
    const pay = (
      reservationId: string,
      amount: number,
      paymentMethod = PaymentMethod.CASH,
      reference?: string,
    ) =>
      service.registerPayment(
        reservationId,
        { amount, paymentMethod, reference },
        author(),
        NOW,
      );

    // todos los movimientos se registran en NOW: se buscan por tipo y monto, no por posición
    const findEntry = (
      dto: ReservationAccountDto,
      type: AccountEntryType,
      amount: number,
    ) =>
      dto.account?.entries.find(
        (entry) => entry.type === type && entry.amount === amount,
      );

    /** Cuenta con un cargo de `amount`: el huésped debe eso. */
    const seedOwingAccount = async (amount = 10000) => {
      const reservationId = await seedOpenAccount();
      const created = await service.registerEntry(
        reservationId,
        charge(amount),
        author(),
        NOW,
      );
      return { reservationId, chargeId: created.id };
    };

    it('registra pagos parciales con distintos medios y devuelve el saldo restante', async () => {
      const { reservationId } = await seedOwingAccount(10000);

      const first = await pay(reservationId, 4000, PaymentMethod.CASH);
      expect(first.account?.balance).toBe(6000);

      const second = await pay(
        reservationId,
        6000,
        PaymentMethod.CARD,
        '  cupón 4521 ',
      );
      expect(second.account).toMatchObject({
        totalPayments: 10000,
        balance: 0,
      });
      expect(findEntry(second, AccountEntryType.PAYMENT, 6000)).toMatchObject({
        paymentMethod: PaymentMethod.CARD,
        reference: 'cupón 4521',
        description: 'Pago en tarjeta',
        origin: AccountEntryOrigin.RECEPTION,
        registeredBy: { id: user.id, fullName: 'Lucía Recepción' },
      });

      const rows = await entryRows(reservationId);
      expect(rows.map((row) => row.paymentMethod ?? null).sort()).toEqual(
        [PaymentMethod.CARD, PaymentMethod.CASH, null].sort(),
      );
    });

    it('rechaza un pago mayor al saldo pendiente sin registrarlo', async () => {
      const { reservationId } = await seedOwingAccount(10000);

      await expect(pay(reservationId, 10000.01)).rejects.toThrow(
        /supera el saldo pendiente/,
      );
      expect(await entryRows(reservationId)).toHaveLength(1);
    });

    it('dos pagos simultáneos no pueden pasarse del saldo', async () => {
      const { reservationId } = await seedOwingAccount(10000);

      const results = await Promise.allSettled([
        pay(reservationId, 7000),
        pay(reservationId, 7000),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const { account } = await service.getForReservation(reservationId);
      expect(account?.balance).toBe(3000);
    });

    it('404 si la reserva no tiene cuenta', async () => {
      const reservationId = await seedReservation();

      await expect(pay(reservationId, 100)).rejects.toThrow(NotFoundException);
    });

    it('anula un pago con un movimiento que lo referencia y el saldo vuelve a subir', async () => {
      const { reservationId } = await seedOwingAccount(10000);
      const paid = await pay(
        reservationId,
        10000,
        PaymentMethod.TRANSFER,
        'op-1',
      );
      const paymentId = findEntry(paid, AccountEntryType.PAYMENT, 10000)!.id;

      const reversed = await service.reversePayment(
        reservationId,
        paymentId,
        '  Se cargó dos veces ',
        author(),
        NOW,
      );

      expect(reversed.account?.balance).toBe(10000);
      expect(
        findEntry(reversed, AccountEntryType.PAYMENT_REVERSAL, 10000),
      ).toMatchObject({
        reversesId: paymentId,
        amount: 10000,
        description: 'Se cargó dos veces',
        paymentMethod: PaymentMethod.TRANSFER,
        reference: 'op-1',
      });
      expect(
        findEntry(reversed, AccountEntryType.PAYMENT, 10000)?.reversed,
      ).toBe(true);
    });

    it('por el endpoint de pagos no se anula un cargo', async () => {
      const { reservationId, chargeId } = await seedOwingAccount();

      await expect(
        service.reversePayment(reservationId, chargeId, 'Error', author(), NOW),
      ).rejects.toThrow(/El pago no pertenece/);
      expect(await entryRows(reservationId)).toHaveLength(1);
    });

    it('la anulación de un pago exige el motivo', async () => {
      const { reservationId } = await seedOwingAccount();
      const paid = await pay(reservationId, 1000);

      await expect(
        service.reversePayment(
          reservationId,
          findEntry(paid, AccountEntryType.PAYMENT, 1000)!.id,
          '   ',
          author(),
          NOW,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('reintegra el saldo a favor hasta dejarlo en cero', async () => {
      const { reservationId, chargeId } = await seedOwingAccount(10000);
      await pay(reservationId, 10000);
      await service.reverseEntry(
        reservationId,
        chargeId,
        'No correspondía',
        author(),
        NOW,
      );

      const partial = await service.registerRefund(
        reservationId,
        {
          amount: 4000,
          paymentMethod: PaymentMethod.CASH,
          reason: 'Devolución parcial',
        },
        author(),
        NOW,
      );
      expect(partial.account?.balance).toBe(-6000);

      await expect(
        service.registerRefund(
          reservationId,
          {
            amount: 6000.01,
            paymentMethod: PaymentMethod.CASH,
            reason: 'Resto',
          },
          author(),
          NOW,
        ),
      ).rejects.toThrow(/supera el saldo a favor/);

      const full = await service.registerRefund(
        reservationId,
        {
          amount: 6000,
          paymentMethod: PaymentMethod.TRANSFER,
          reason: '  Resto  ',
        },
        author(),
        NOW,
      );
      expect(full.account?.balance).toBe(0);
      expect(findEntry(full, AccountEntryType.REFUND, 6000)).toMatchObject({
        paymentMethod: PaymentMethod.TRANSFER,
        description: 'Resto',
        reference: null,
      });
    });

    it('sin saldo a favor no se puede reintegrar', async () => {
      const { reservationId } = await seedOwingAccount();

      await expect(
        service.registerRefund(
          reservationId,
          { amount: 1, paymentMethod: PaymentMethod.CASH, reason: 'Error' },
          author(),
          NOW,
        ),
      ).rejects.toThrow(/no tiene saldo a favor/);
    });
  });
});
