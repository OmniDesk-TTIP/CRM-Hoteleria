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
import { ReservationRepository } from '../reservation/reservation.repository';
import { ReservationAdminService } from '../reservation/reservation-admin.service';
import { StatisticsRepository } from '../statistics/statistics.repository';
import { CancellationService } from './cancellation.service';
import { CancellationTier } from './cancellation.model';
import { CancellationPolicy } from '../../infrastructure/database/entities/CancellationPolicy.entity';
import {
  RefundStatus,
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import {
  ChatMessage,
  MessageRole,
} from '../../infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';

describe('CancellationService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: CancellationService;
  let reservationRepository: ReservationRepository;
  let adminService: ReservationAdminService;
  let statisticsRepository: StatisticsRepository;
  const sendMessage = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const GUEST_NAME = 'Ana Cancelaciones';
  const DEPOSIT = 30000;
  // Todo pasa en 2099 para que ninguna reserva de estos tests se cruce con datos reales de la base.
  const FIRST_CHECK_IN = Date.UTC(2099, 5, 1);
  const TIERS: CancellationTier[] = [
    { minDaysBeforeCheckIn: 7, refundPercentage: 100 },
    { minDaysBeforeCheckIn: 3, refundPercentage: 50 },
  ];

  let categoryId: string;
  let roomId: string;
  let previousActivePolicyId: string | null = null;
  let policyName: string;
  let policyId: string;
  const policyIds: string[] = [];
  const reservationIds: string[] = [];
  let stayIndex = 0;

  // Lo que tienen que sumar los indicadores de ingresos al final (CA6): se va acumulando a medida
  // que los tests cancelan o completan devoluciones.
  const ledger = { retained: 0, pending: 0, completed: 0 };

  const dayString = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const localNoon = (ms: number) => {
    const [y, m, d] = dayString(ms).split('-').map(Number);
    return new Date(y, m - 1, d, 12);
  };

  /**
   * Crea una reserva de 2 noches en una ventana propia (así nunca se pisan entre sí, ni en la
   * habitación compartida) y devuelve el "ahora" que deja exactamente `daysAhead` días hasta el check-in.
   */
  const seed = async ({
    daysAhead,
    status = ReservationStatus.CONFIRMED,
    telegramUserId = `tg-cancel-${next()}`,
  }: {
    daysAhead: number;
    status?: ReservationStatus;
    telegramUserId?: string;
  }) => {
    const checkIn = FIRST_CHECK_IN + stayIndex++ * 5 * MS_PER_DAY;
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn: localNoon(checkIn),
      checkOut: localNoon(checkIn + 2 * MS_PER_DAY),
      status,
      totalAmount: 100000,
      depositAmount: DEPOSIT,
      guestFullName: GUEST_NAME,
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    reservationIds.push(reservation.id);

    const now = new Date(
      checkIn - daysAhead * MS_PER_DAY + 15 * 60 * 60 * 1000,
    );
    return {
      id: reservation.id,
      telegramUserId,
      now,
      checkIn: dayString(checkIn),
      checkOut: dayString(checkIn + 2 * MS_PER_DAY),
    };
  };

  /** Cancela una reserva pagada y suma su efecto al ledger de indicadores. */
  const cancelPaid = async (daysAhead: number) => {
    const stay = await seed({ daysAhead });
    const outcome = await service.cancelReservation(stay.id, stay.now);
    ledger.retained += DEPOSIT - outcome.refundAmount;
    ledger.pending += outcome.refundAmount;
    return { stay, outcome };
  };

  const rowOf = (id: string) =>
    em.fork().findOneOrFail(Reservation, { id }, { refresh: true });

  const createPolicy = async (
    tiers: CancellationTier[] = TIERS,
    name = `Política ${next()}`,
  ) => {
    const policy = await service.createPolicy({ name, tiers });
    policyIds.push(policy.id);
    return policy;
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
        telegram: { sendMessage },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(CancellationService);
    reservationRepository = app.get(ReservationRepository);
    adminService = app.get(ReservationAdminService);
    statisticsRepository = app.get(StatisticsRepository, { strict: false });

    const category = em.create(RoomCategory, {
      name: `Cat cancel ${suffix}`,
      capacity: 2,
      basePrice: 50000,
    });
    const room = em.create(Room, {
      roomNumber: `CANCEL-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;

    // La política vigente es global: se guarda la que había para devolverla al terminar.
    previousActivePolicyId =
      (await em.fork().findOne(CancellationPolicy, { active: true }))?.id ??
      null;
    const policy = await createPolicy();
    await service.activatePolicy(policy.id);
    policyName = policy.name;
    policyId = policy.id;
  });

  beforeEach(() => {
    orm.em.clear();
  });

  afterAll(async () => {
    // Cada paso por separado: si uno falla, los demás igual limpian. Si no, la habitación queda
    // libre en la base compartida y otras suites (telegram e2e) la terminan reservando.
    const steps = [
      () =>
        previousActivePolicyId
          ? service.activatePolicy(previousActivePolicyId)
          : undefined,
      () => em.nativeDelete(Reservation, { id: { $in: reservationIds } }),
      () => (roomId ? em.nativeDelete(Reservation, { room: roomId }) : 0),
      () => em.nativeDelete(CancellationPolicy, { id: { $in: policyIds } }),
      () => (roomId ? em.nativeDelete(Room, { id: roomId }) : 0),
      () =>
        categoryId ? em.nativeDelete(RoomCategory, { id: categoryId }) : 0,
      () =>
        em.nativeDelete(ChatMessage, {
          telegramUserId: { $like: 'tg-cancel-%' },
        }),
      () =>
        em.nativeDelete(ChatSession, {
          telegramUserId: { $like: 'tg-cancel-%' },
        }),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch {
        // no-op: limpieza best-effort
      }
    }
    if (app) await app.close();
  });

  describe('políticas de cancelación (CA1)', () => {
    it('crea la política con los escalones ordenados de más a menos anticipación y la persiste', async () => {
      const policy = await createPolicy([
        { minDaysBeforeCheckIn: 2, refundPercentage: 20 },
        { minDaysBeforeCheckIn: 15, refundPercentage: 100 },
        { minDaysBeforeCheckIn: 7, refundPercentage: 50 },
      ]);

      const row = await em
        .fork()
        .findOneOrFail(CancellationPolicy, { id: policy.id });
      expect(row.tiers).toEqual([
        { minDaysBeforeCheckIn: 15, refundPercentage: 100 },
        { minDaysBeforeCheckIn: 7, refundPercentage: 50 },
        { minDaysBeforeCheckIn: 2, refundPercentage: 20 },
      ]);
      expect(row.active).toBe(false);
    });

    it('rechaza un nombre repetido sin distinguir mayúsculas', async () => {
      await expect(
        service.createPolicy({ name: policyName.toUpperCase(), tiers: TIERS }),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      [
        'repite los días de anticipación',
        [
          { minDaysBeforeCheckIn: 5, refundPercentage: 100 },
          { minDaysBeforeCheckIn: 5, refundPercentage: 50 },
        ],
        /mismos días/,
      ],
      [
        'devuelve más con menos anticipación',
        [
          { minDaysBeforeCheckIn: 7, refundPercentage: 20 },
          { minDaysBeforeCheckIn: 2, refundPercentage: 80 },
        ],
        /más anticipación/,
      ],
      [
        'pasa del 100%',
        [{ minDaysBeforeCheckIn: 7, refundPercentage: 120 }],
        /entre 0 y 100/,
      ],
      [
        'tiene días negativos',
        [{ minDaysBeforeCheckIn: -1, refundPercentage: 50 }],
        /enteros de 0 o más/,
      ],
    ])(
      'rechaza escalones inconsistentes: %s',
      async (_label, tiers, message) => {
        await expect(
          service.createPolicy({ name: `Mala ${next()}`, tiers }),
        ).rejects.toThrow(message);
        await expect(
          service.createPolicy({ name: `Mala ${next()}`, tiers }),
        ).rejects.toThrow(BadRequestException);
      },
    );

    it('edita el nombre y los escalones', async () => {
      const policy = await createPolicy();
      const newName = `Renombrada ${next()}`;

      await service.updatePolicy(policy.id, {
        name: newName,
        tiers: [{ minDaysBeforeCheckIn: 10, refundPercentage: 80 }],
      });

      const row = await em
        .fork()
        .findOneOrFail(CancellationPolicy, { id: policy.id });
      expect(row.name).toBe(newName);
      expect(row.tiers).toEqual([
        { minDaysBeforeCheckIn: 10, refundPercentage: 80 },
      ]);
    });

    it('al editar, rechaza tomar el nombre de otra política y valida los escalones', async () => {
      const other = await createPolicy();

      await expect(
        service.updatePolicy(other.id, { name: policyName }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.updatePolicy(other.id, { tiers: [] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('responde 404 al editar o activar una política que no existe', async () => {
      const missing = '5b0f7f8e-6c53-4d3f-9a7c-1f6f1d0f0099';

      await expect(service.updatePolicy(missing, {})).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.activatePolicy(missing)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('al activar una política, queda como única vigente', async () => {
      const other = await createPolicy();

      await service.activatePolicy(other.id);

      const actives = await em
        .fork()
        .find(CancellationPolicy, { active: true });
      expect(actives.map((policy) => policy.id)).toEqual([other.id]);

      // Se devuelve la vigente de los demás tests.
      await service.activatePolicy(policyId);
      const afterwards = await em
        .fork()
        .find(CancellationPolicy, { active: true });
      expect(afterwards.map((policy) => policy.id)).toEqual([policyId]);
    });

    it('lista las políticas con la vigente primero', async () => {
      const policies = await service.listPolicies();

      expect(policies[0].id).toBe(policyId);
      expect(policies[0].active).toBe(true);
    });
  });

  describe('cancelar una reserva (CA2, CA6, CA7)', () => {
    it('con 7 o más días de anticipación devuelve el 100% de la seña, queda pendiente y conserva la política aplicada', async () => {
      const { stay, outcome } = await cancelPaid(10);

      expect(outcome).toMatchObject({
        reservationId: stay.id,
        alreadyCancelled: false,
        wasPaid: true,
        daysInAdvance: 10,
        refundPercentage: 100,
        refundAmount: 30000,
        policyName,
      });
      const row = await rowOf(stay.id);
      expect(row.status).toBe(ReservationStatus.CANCELLED);
      expect(row.refundStatus).toBe(RefundStatus.PENDING);
      expect(row.cancellationPolicyName).toBe(policyName);
      expect(Number(row.refundPercentage)).toBe(100);
      expect(Number(row.refundAmount)).toBe(30000);
      expect(row.cancelledAt).toEqual(stay.now);
      expect(row.refundedAt).toBeFalsy();
    });

    it('con 3 a 6 días de anticipación devuelve el 50%', async () => {
      const { stay, outcome } = await cancelPaid(5);

      expect(outcome).toMatchObject({
        refundPercentage: 50,
        refundAmount: 15000,
      });
      expect(Number((await rowOf(stay.id)).refundAmount)).toBe(15000);
    });

    it('justo en el borde del escalón (7 y 3 días) aplica el escalón y no el de abajo', async () => {
      const seven = await cancelPaid(7);
      const three = await cancelPaid(3);
      const two = await cancelPaid(2);

      expect(seven.outcome.refundPercentage).toBe(100);
      expect(three.outcome.refundPercentage).toBe(50);
      expect(two.outcome.refundPercentage).toBe(0);
    });

    it('por debajo del escalón más bajo cancela sin devolución: no genera devolución pendiente pero conserva el monto 0 y la política', async () => {
      const { stay, outcome } = await cancelPaid(1);

      expect(outcome).toMatchObject({ refundPercentage: 0, refundAmount: 0 });
      const row = await rowOf(stay.id);
      expect(row.status).toBe(ReservationStatus.CANCELLED);
      expect(row.refundStatus).toBeFalsy();
      expect(Number(row.refundAmount)).toBe(0);
      expect(row.cancellationPolicyName).toBe(policyName);
    });

    it('una reserva sin pagar se cancela sin devolución ni monto registrado (no suma a los ingresos)', async () => {
      const stay = await seed({
        daysAhead: 10,
        status: ReservationStatus.PENDING_PAYMENT,
      });

      const outcome = await service.cancelReservation(stay.id, stay.now);

      expect(outcome).toMatchObject({ wasPaid: false, refundAmount: 0 });
      const row = await rowOf(stay.id);
      expect(row.status).toBe(ReservationStatus.CANCELLED);
      expect(row.cancelledAt).toEqual(stay.now);
      expect(row.refundAmount).toBeFalsy();
      expect(row.refundStatus).toBeFalsy();
    });

    it('es idempotente: cancelar dos veces no pisa nada ni genera otra devolución (doble confirmación)', async () => {
      const { stay } = await cancelPaid(10);
      const before = await rowOf(stay.id);

      const again = await service.cancelReservation(
        stay.id,
        new Date(stay.now.getTime() + MS_PER_DAY),
      );

      expect(again).toMatchObject({
        alreadyCancelled: true,
        refundAmount: 30000,
      });
      const after = await rowOf(stay.id);
      expect(after.cancelledAt).toEqual(before.cancelledAt);
      expect(after.refundStatus).toBe(RefundStatus.PENDING);
    });

    it('si dos cancelaciones llegan a la vez, solo una genera la devolución', async () => {
      const stay = await seed({ daysAhead: 10 });

      const [first, second] = await Promise.all([
        service.cancelReservation(stay.id, stay.now),
        service.cancelReservation(stay.id, stay.now),
      ]);

      expect([first.alreadyCancelled, second.alreadyCancelled].sort()).toEqual([
        false,
        true,
      ]);
      ledger.pending += 30000;
      expect(Number((await rowOf(stay.id)).refundAmount)).toBe(30000);
    });

    it('libera la habitación en el acto para nuevas consultas de disponibilidad', async () => {
      const stay = await seed({ daysAhead: 10 });
      const checkIn = localNoon(Date.parse(stay.checkIn));
      const checkOut = localNoon(Date.parse(stay.checkOut));
      expect(
        await reservationRepository.isRoomOccupied(roomId, checkIn, checkOut),
      ).toBe(true);

      const outcome = await service.cancelReservation(stay.id, stay.now);
      ledger.retained += DEPOSIT - outcome.refundAmount;
      ledger.pending += outcome.refundAmount;

      expect(
        await reservationRepository.isRoomOccupied(roomId, checkIn, checkOut),
      ).toBe(false);
    });

    it('un cambio posterior de la política no altera lo ya aplicado a una reserva cancelada (CA6)', async () => {
      const { stay } = await cancelPaid(10);
      const edited = await createPolicy([
        { minDaysBeforeCheckIn: 30, refundPercentage: 10 },
      ]);
      await service.activatePolicy(edited.id);

      const row = await rowOf(stay.id);
      expect(row.cancellationPolicyName).toBe(policyName);
      expect(Number(row.refundPercentage)).toBe(100);

      await service.activatePolicy(policyId);
    });

    it('responde 404 si la reserva no existe', async () => {
      await expect(
        service.cancelReservation('5b0f7f8e-6c53-4d3f-9a7c-1f6f1d0f0098'),
      ).rejects.toThrow(NotFoundException);
    });

    it('desde el panel (DELETE /reservations/:id) también calcula la devolución y libera la habitación (US-5 CA5)', async () => {
      const stay = await seed({ daysAhead: 10 });

      // Usa el reloj real: la reserva es de 2099, así que cae en el escalón del 100%.
      const outcome = await adminService.cancel(stay.id);

      expect(outcome).toMatchObject({
        refundPercentage: 100,
        refundAmount: 30000,
      });
      const row = await rowOf(stay.id);
      expect(row.status).toBe(ReservationStatus.CANCELLED);
      expect(row.refundStatus).toBe(RefundStatus.PENDING);
      // Su cancelledAt es de hoy, no de 2099: no entra en el ledger de los indicadores.
    });

    it('desde el formulario de edición, pasar a Cancelada también genera la devolución', async () => {
      const stay = await seed({ daysAhead: 10 });

      const dto = await adminService.update(stay.id, {
        guestFullName: GUEST_NAME,
        guestDni: '30111222',
        roomId,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        status: ReservationStatus.CANCELLED,
        totalAmount: 100000,
        depositAmount: DEPOSIT,
      });

      expect(dto).toMatchObject({
        status: ReservationStatus.CANCELLED,
        refundStatus: RefundStatus.PENDING,
        refundAmount: 30000,
        cancellationPolicyName: policyName,
      });
    });
  });

  describe('devoluciones pendientes (CA4, CA5)', () => {
    const findRefund = async (id: string, status?: RefundStatus) =>
      (await service.listRefunds({ status, page: 1, pageSize: 100 })).data.find(
        (refund) => refund.reservationId === id,
      );

    it('el listado muestra reserva, huésped, monto y fecha de cancelación de la devolución pendiente', async () => {
      const { stay } = await cancelPaid(5);

      const refund = await findRefund(stay.id);

      expect(refund).toMatchObject({
        reservationId: stay.id,
        guestFullName: GUEST_NAME,
        guestDni: '30111222',
        roomNumber: `CANCEL-${suffix}`,
        amount: 15000,
        percentage: 50,
        policyName,
        status: RefundStatus.PENDING,
        refundedAt: null,
      });
      expect(refund?.cancelledAt).toEqual(stay.now);
    });

    it('no lista las cancelaciones sin devolución ni las reservas sin cancelar', async () => {
      const noRefund = await cancelPaid(1);
      const live = await seed({ daysAhead: 10 });

      expect(await findRefund(noRefund.stay.id)).toBeUndefined();
      expect(await findRefund(live.id)).toBeUndefined();
    });

    it('marca la devolución como realizada con la fecha indicada y pasa de un filtro al otro', async () => {
      const { stay } = await cancelPaid(5);

      const completed = await service.completeRefund(
        stay.id,
        { refundedAt: '2099-07-01' },
        new Date(Date.UTC(2099, 6, 2)),
      );

      expect(completed.status).toBe(RefundStatus.COMPLETED);
      expect(completed.refundedAt).toEqual(new Date('2099-07-01'));
      ledger.pending -= 15000;
      ledger.completed += 15000;
      expect(await findRefund(stay.id, RefundStatus.PENDING)).toBeUndefined();
      expect(await findRefund(stay.id, RefundStatus.COMPLETED)).toMatchObject({
        amount: 15000,
      });
    });

    it('sin fecha, registra el momento actual', async () => {
      const { stay } = await cancelPaid(5);
      const now = new Date(Date.UTC(2099, 7, 1, 12));

      const completed = await service.completeRefund(stay.id, {}, now);

      expect(completed.refundedAt).toEqual(now);
      ledger.pending -= 15000;
      ledger.completed += 15000;
    });

    it('no deja marcar dos veces la misma devolución (409) ni pisa la fecha original', async () => {
      const { stay } = await cancelPaid(5);
      const now = new Date(Date.UTC(2099, 7, 1, 12));
      await service.completeRefund(stay.id, { refundedAt: '2099-07-01' }, now);
      ledger.pending -= 15000;
      ledger.completed += 15000;

      await expect(
        service.completeRefund(stay.id, { refundedAt: '2099-07-15' }, now),
      ).rejects.toThrow(ConflictException);
      expect((await rowOf(stay.id)).refundedAt).toEqual(new Date('2099-07-01'));
    });

    it('rechaza una fecha futura', async () => {
      const { stay } = await cancelPaid(5);

      await expect(
        service.completeRefund(
          stay.id,
          { refundedAt: '2099-12-31' },
          new Date(Date.UTC(2099, 7, 1)),
        ),
      ).rejects.toThrow(BadRequestException);
      expect((await rowOf(stay.id)).refundStatus).toBe(RefundStatus.PENDING);
    });

    it('responde 404 si la reserva no tiene devolución (sin cancelar, sin monto o inexistente)', async () => {
      const live = await seed({ daysAhead: 10 });
      const noRefund = await cancelPaid(1);

      await expect(service.completeRefund(live.id, {})).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.completeRefund(noRefund.stay.id, {}),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.completeRefund('5b0f7f8e-6c53-4d3f-9a7c-1f6f1d0f0097', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('pagina el listado', async () => {
      const page = await service.listRefunds({ page: 1, pageSize: 1 });

      expect(page.data).toHaveLength(1);
      expect(page.total).toBeGreaterThan(1);
      expect(page).toMatchObject({ page: 1, pageSize: 1 });
    });
  });

  describe('Chamber (CA2, CA3)', () => {
    it('informa la política y, de cada reserva del cliente, cuánto se le devolvería si cancela hoy', async () => {
      const stay = await seed({ daysAhead: 5 });

      const { block, canCancel } = await service.getGuestContextBlock(
        stay.telegramUserId,
        stay.now,
      );

      expect(canCancel).toBe(true);
      expect(block).toContain('[POLÍTICA DE CANCELACIÓN]');
      expect(block).toContain(policyName);
      expect(block).toContain('devolución del 100% de la seña');
      expect(block).toContain(`id=${stay.id}`);
      expect(block).toContain(
        'se le devuelven $15000 (50% de la seña de $30000)',
      );
    });

    it('a un cliente sin reservas le informa la política pero no habilita cancelar', async () => {
      const { block, canCancel } = await service.getGuestContextBlock(
        `tg-sin-reservas-${next()}`,
      );

      expect(canCancel).toBe(false);
      expect(block).toContain('devolución del 50% de la seña');
      expect(block).not.toContain('RESERVAS DEL CLIENTE');
    });

    it('no ofrece cancelar reservas ya canceladas ni estadías que terminaron', async () => {
      const cancelled = await seed({ daysAhead: 10 });
      await service.cancelReservation(cancelled.id, cancelled.now);
      ledger.pending += 30000;
      const past = await seed({ daysAhead: -30 });

      const { block, canCancel } = await service.getGuestContextBlock(
        cancelled.telegramUserId,
        cancelled.now,
      );
      const pastBlock = await service.getGuestContextBlock(
        past.telegramUserId,
        past.now,
      );

      // La cancelada solo puede aparecer como devolución pendiente, nunca entre las que se pueden cancelar.
      const [cancellable] = block.split('DEVOLUCIONES PENDIENTES DEL CLIENTE');
      expect(canCancel).toBe(false);
      expect(cancellable).not.toContain(`id=${cancelled.id}`);
      expect(pastBlock.canCancel).toBe(false);
    });

    it('arma el resumen de la política que se agrega al mensaje de la reserva', async () => {
      const summary = await service.getPolicySummary();

      expect(summary).toContain('Política de cancelación');
      expect(summary).toContain('devolución del 100% de la seña');
    });

    it('cancela la reserva del huésped y le informa el monto a reintegrar', async () => {
      const stay = await seed({ daysAhead: 5 });

      const result = await service.cancelForGuest(
        stay.telegramUserId,
        stay.id,
        stay.now,
      );

      expect(result.ok).toBe(true);
      expect(result).toMatchObject({
        reply: expect.stringContaining('<b>$15000</b>'),
      });
      ledger.pending += 15000;
      ledger.retained += DEPOSIT - 15000;
      expect((await rowOf(stay.id)).refundStatus).toBe(RefundStatus.PENDING);
    });

    it('no deja cancelar una reserva de otra persona', async () => {
      const stay = await seed({ daysAhead: 5 });

      const result = await service.cancelForGuest(
        `tg-otro-${next()}`,
        stay.id,
        stay.now,
      );

      expect(result.ok).toBe(false);
      expect((await rowOf(stay.id)).status).toBe(ReservationStatus.CONFIRMED);
    });

    it('avisa si la reserva ya estaba cancelada', async () => {
      const stay = await seed({ daysAhead: 5 });
      await service.cancelForGuest(stay.telegramUserId, stay.id, stay.now);
      ledger.pending += 15000;
      ledger.retained += DEPOSIT - 15000;

      const again = await service.cancelForGuest(
        stay.telegramUserId,
        stay.id,
        stay.now,
      );

      expect(again).toMatchObject({ ok: false });
    });
  });

  describe('cuenta para la devolución y aviso al huésped', () => {
    const ALIAS = 'ana.cancela.mp';
    const HOLDER = 'Ana Cancelaciones';

    beforeEach(() => {
      sendMessage.mockReset();
      sendMessage.mockResolvedValue({});
    });

    const refundRow = async (id: string) =>
      (await service.listRefunds({ page: 1, pageSize: 100 })).data.find(
        (refund) => refund.reservationId === id,
      );

    it('después de cancelar, Chamber ve la devolución sin cuenta y puede pedirla', async () => {
      const { stay } = await cancelPaid(5);

      const context = await service.getGuestContextBlock(
        stay.telegramUserId,
        stay.now,
      );

      expect(context.canCancel).toBe(false);
      expect(context.canRegisterRefundAccount).toBe(true);
      expect(context.block).toContain('DEVOLUCIONES PENDIENTES DEL CLIENTE');
      expect(context.block).toContain(`id=${stay.id}`);
      expect(context.block).toContain('a devolver $15000 | FALTA LA CUENTA');
    });

    it('sin devoluciones pendientes no habilita cargar una cuenta', async () => {
      const stay = await seed({ daysAhead: 5 });

      const context = await service.getGuestContextBlock(
        stay.telegramUserId,
        stay.now,
      );

      expect(context.canRegisterRefundAccount).toBe(false);
      expect(context.block).not.toContain('DEVOLUCIONES PENDIENTES');
    });

    it('guarda el alias normalizado y el titular, y el panel los muestra', async () => {
      const { stay } = await cancelPaid(5);

      const result = await service.registerRefundAccountForGuest(
        stay.telegramUserId,
        stay.id,
        '  Ana.Cancela.MP ',
        HOLDER,
      );

      expect(result).toMatchObject({
        ok: true,
        reply: expect.stringContaining(`Alias: <b>${ALIAS}</b>`),
      });
      const row = await rowOf(stay.id);
      expect(row.refundAccountAlias).toBe(ALIAS);
      expect(row.refundAccountHolder).toBe(HOLDER);
      expect(await refundRow(stay.id)).toMatchObject({
        accountAlias: ALIAS,
        accountHolder: HOLDER,
        notifiableByTelegram: true,
      });

      const { block } = await service.getGuestContextBlock(
        stay.telegramUserId,
        stay.now,
      );
      expect(block).toContain(
        `cuenta informada: alias ${ALIAS}, titular ${HOLDER}`,
      );
    });

    it('deja corregir la cuenta mientras la devolución está pendiente', async () => {
      const { stay } = await cancelPaid(5);
      await service.registerRefundAccountForGuest(
        stay.telegramUserId,
        stay.id,
        ALIAS,
        HOLDER,
      );

      await service.registerRefundAccountForGuest(
        stay.telegramUserId,
        stay.id,
        'otro.alias.uala',
        'Juan Pérez',
      );

      expect(await rowOf(stay.id)).toMatchObject({
        refundAccountAlias: 'otro.alias.uala',
        refundAccountHolder: 'Juan Pérez',
      });
    });

    it('rechaza un alias inválido sin guardar nada', async () => {
      const { stay } = await cancelPaid(5);

      const result = await service.registerRefundAccountForGuest(
        stay.telegramUserId,
        stay.id,
        'mal alias',
        HOLDER,
      );

      expect(result).toMatchObject({ ok: false });
      expect((await rowOf(stay.id)).refundAccountAlias ?? null).toBeNull();
    });

    it('no deja cargar la cuenta en la devolución de otra persona', async () => {
      const { stay } = await cancelPaid(5);

      const result = await service.registerRefundAccountForGuest(
        `tg-otro-${next()}`,
        stay.id,
        ALIAS,
        HOLDER,
      );

      expect(result).toMatchObject({ ok: false });
      expect((await rowOf(stay.id)).refundAccountAlias ?? null).toBeNull();
    });

    it('no deja cambiar la cuenta de una devolución ya realizada', async () => {
      const { stay } = await cancelPaid(5);
      await service.completeRefund(stay.id, {}, stay.now);
      ledger.pending -= 15000;
      ledger.completed += 15000;

      const result = await service.registerRefundAccountForGuest(
        stay.telegramUserId,
        stay.id,
        ALIAS,
        HOLDER,
      );

      expect(result).toMatchObject({
        ok: false,
        reason: expect.stringContaining('ya figura como realizada'),
      });
    });

    it('al marcarla como realizada le avisa al huésped por Telegram y lo deja en el chat', async () => {
      const { stay } = await cancelPaid(5);
      await service.registerRefundAccountForGuest(
        stay.telegramUserId,
        stay.id,
        ALIAS,
        HOLDER,
      );

      const completed = await service.completeRefund(stay.id, {}, stay.now);
      ledger.pending -= 15000;
      ledger.completed += 15000;

      expect(completed).toMatchObject({
        status: RefundStatus.COMPLETED,
        guestNotified: true,
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [chatId, text, options] = sendMessage.mock.calls[0];
      expect(chatId).toBe(stay.telegramUserId);
      expect(text).toContain('<b>$15000</b>');
      expect(text).toContain(`alias <b>${ALIAS}</b>`);
      expect(text).toContain('Revisá tu cuenta');
      expect(options).toEqual({ parse_mode: 'HTML' });

      const recorded = await em.fork().findOne(ChatMessage, {
        telegramUserId: stay.telegramUserId,
        role: MessageRole.BOT,
      });
      expect(recorded?.content).toBe(text);
    });

    it('si Telegram falla, la devolución queda realizada igual', async () => {
      const { stay } = await cancelPaid(5);
      sendMessage.mockRejectedValue(new Error('Forbidden: bot was blocked'));

      const completed = await service.completeRefund(stay.id, {}, stay.now);
      ledger.pending -= 15000;
      ledger.completed += 15000;

      expect(completed).toMatchObject({
        status: RefundStatus.COMPLETED,
        guestNotified: false,
      });
      expect((await rowOf(stay.id)).refundStatus).toBe(RefundStatus.COMPLETED);
    });

    it('una reserva cargada desde el panel no tiene a quién avisarle', async () => {
      const { stay } = await cancelPaid(5);
      await em
        .fork()
        .nativeUpdate(Reservation, { id: stay.id }, { telegramUserId: null });
      // El service usa el EntityManager global: sin esto devolvería la fila cacheada con el telegramUserId.
      orm.em.clear();
      expect(await refundRow(stay.id)).toMatchObject({
        notifiableByTelegram: false,
      });

      const completed = await service.completeRefund(stay.id, {}, stay.now);
      ledger.pending -= 15000;
      ledger.completed += 15000;

      expect(completed.guestNotified).toBe(false);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('indicadores de ingresos (CA6)', () => {
    it('suman lo retenido y las devoluciones pendientes y realizadas de las cancelaciones con seña paga', async () => {
      // Todas las cancelaciones de estos tests tienen cancelledAt en 2099: el filtro las aísla de otros datos.
      const totals = await statisticsRepository.cancellationTotals(
        new Date(Date.UTC(2099, 0, 1)),
      );

      expect(totals).toEqual({
        retained: ledger.retained,
        refundsPending: ledger.pending,
        refundsCompleted: ledger.completed,
      });
    });
  });
});
