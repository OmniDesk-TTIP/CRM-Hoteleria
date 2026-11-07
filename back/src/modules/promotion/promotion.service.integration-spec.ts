import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { ReservationService } from '../reservation/reservation.service';
import { CancellationService } from '../cancellation/cancellation.service';
import { SpaReservationService } from '../spaReservation/spaReservation.service';
import { SpaService as SpaCatalogService } from '../spa/spa.service';
import { StatisticsService } from '../statistics/statistics.service';
import { PromotionService } from './promotion.service';
import { PromotionStatus } from './promotion.model';
import { SavePromotionDto } from './dto/promotion.dto';
import {
  Promotion,
  PromotionTarget,
} from '../../infrastructure/database/entities/Promotion.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  BookingProcess,
  BookingProcessStep,
} from '../../infrastructure/database/entities/BookingProcess.entity';
import { CancellationPolicy } from '../../infrastructure/database/entities/CancellationPolicy.entity';
import { SpaService } from '../../infrastructure/database/entities/SpaService.entity';
import {
  SpaReservation,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';

/**
 * US-21 contra la base de test: promociones, reservas y turnos son filas reales; Mercado Pago,
 * Gemini y Telegram están simulados. Las reglas puras están en promotion.model.spec.ts.
 *
 * "Hoy" es el verdadero, porque las cotizaciones de habitaciones leen las promociones del reloj
 * real: las vigentes se crean alrededor de hoy y las estadías caen en 2099.
 */
describe('PromotionService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: PromotionService;
  let reservations: ReservationService;

  const createPreference = jest.fn();
  const createSpaPreference = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  /** Capacidad que no comparte con ninguna otra habitación de la base de test. */
  const CAPACITY = 95;
  const PRICE = 10000;

  const promotionIds: string[] = [];
  const guestIds: string[] = [];
  let category: RoomCategory;
  let room: Room;
  let spa: SpaService;
  let policy: CancellationPolicy;
  let previousActivePolicyIds: string[] = [];

  const isoDay = (offset: number): string =>
    new Date(Date.now() + offset * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  const payload = (overrides: Partial<SavePromotionDto> = {}) =>
    ({
      title: `Promo ${next()}`,
      description: 'Descuento de prueba',
      discountPercentage: 20,
      startDate: isoDay(-2),
      endDate: isoDay(2),
      target: PromotionTarget.ROOMS,
      minNights: null,
      ...overrides,
    }) as SavePromotionDto;

  const newPromotion = async (overrides: Partial<SavePromotionDto> = {}) => {
    const promotion = await service.create(payload(overrides));
    promotionIds.push(promotion.id);
    return promotion;
  };

  /** Sin el `create`, para poder sembrar una promoción ya vencida. */
  const seedPromotion = async (overrides: Partial<Promotion> = {}) => {
    const fork = em.fork();
    const promotion = fork.create(Promotion, {
      title: `Promo ${next()}`,
      description: 'Descuento de prueba',
      discountPercentage: 20,
      startDate: isoDay(-2),
      endDate: isoDay(2),
      target: PromotionTarget.ROOMS,
      ...overrides,
    });
    await fork.persist(promotion).flush();
    promotionIds.push(promotion.id);
    return promotion;
  };

  const newGuest = () => {
    const telegramUserId = `tg-us21-${next()}`;
    guestIds.push(telegramUserId);
    return telegramUserId;
  };

  /** DD-MM-YYYY de un día de mayo de 2099. Cada test usa su propio tramo para no pisarse. */
  const d = (day: number) => `${String(day).padStart(2, '0')}-05-2099`;

  let nextDay = 1;
  const quote = async (nights: number) => {
    const telegramUserId = newGuest();
    const checkIn = nextDay;
    nextDay += nights + 3;

    const booking = orm.em.create(BookingProcess, {
      telegramUserId,
      step: BookingProcessStep.IN_PROGRESS,
    });
    await orm.em.flush();

    const result = await reservations.searchAvailability(
      telegramUserId,
      booking,
      {
        checkIn: d(checkIn),
        checkOut: d(checkIn + nights),
        capacity: CAPACITY,
      },
    );
    if (!result.available) throw new Error('Se esperaba una oferta');
    return { telegramUserId, booking, reply: result.reply };
  };

  const confirm = (telegramUserId: string, booking: BookingProcess) =>
    reservations.confirmReservation(telegramUserId, booking, {
      fullName: 'Ana Promo',
      dni: '30111222',
    });

  const savedReservation = async (telegramUserId: string) => {
    await orm.em.flush();
    return em.fork().findOneOrFail(Reservation, { telegramUserId });
  };

  beforeAll(async () => {
    process.env.FRONTEND_BASE_URL ??= 'http://localhost:5173';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ ingestDocument: jest.fn(), askQuestion: jest.fn() })
      .overrideProvider(PaymentService)
      .useValue({
        createPreference,
        createSpaPreference,
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
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(PromotionService);
    reservations = app.get(ReservationService);

    category = em.create(RoomCategory, {
      name: `US21 Categoría ${suffix}`,
      capacity: CAPACITY,
      basePrice: PRICE,
    });
    room = em.create(Room, {
      roomNumber: `US21-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    spa = em.create(SpaService, {
      name: `US21 Masaje ${suffix}`,
      description: 'Masaje',
      durationMinutes: 60,
      price: 15000,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
      opensAt: '10:00',
      closesAt: '20:00',
    });
    await em.persist([category, room, spa]).flush();

    const active = await em.find(CancellationPolicy, { active: true });
    previousActivePolicyIds = active.map((row) => row.id);
    await em.nativeUpdate(CancellationPolicy, {}, { active: false });
    policy = em.create(CancellationPolicy, {
      name: `US21 Política ${suffix}`,
      tiers: [{ minDaysBeforeCheckIn: 1, refundPercentage: 50 }],
      active: true,
    });
    await em.persist(policy).flush();
  });

  beforeEach(async () => {
    // Otras suites comparten la base: solo cuentan las promociones que crea cada test.
    await em.nativeUpdate(Promotion, {}, { enabled: false });
    createPreference.mockReset();
    createPreference.mockResolvedValue({
      preferenceId: 'pref-1',
      initPoint: 'https://mp.example/pagar',
    });
    createSpaPreference.mockReset();
    createSpaPreference.mockResolvedValue({
      preferenceId: 'pref-spa',
      initPoint: 'https://mp.example/pagar-turno',
    });
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(SpaReservation, {
        telegramUserId: { $in: guestIds },
      });
      await em.nativeDelete(Reservation, {
        telegramUserId: { $in: guestIds },
      });
      await em.nativeDelete(BookingProcess, {
        telegramUserId: { $in: guestIds },
      });
      await em.nativeDelete(Promotion, { id: { $in: promotionIds } });
      await em.nativeDelete(SpaService, { id: spa.id });
      await em.nativeDelete(Room, { id: room.id });
      await em.nativeDelete(RoomCategory, { id: category.id });
      await em.nativeDelete(CancellationPolicy, { id: policy.id });
      await em.nativeUpdate(
        CancellationPolicy,
        { id: { $in: previousActivePolicyIds } },
        { active: true },
      );
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('administración (CA1 a CA3)', () => {
    it('crea y edita una promoción', async () => {
      const created = await newPromotion({ minNights: 3 });
      expect(created).toMatchObject({
        status: PromotionStatus.ACTIVE,
        enabled: true,
        minNights: 3,
      });

      const edited = await service.update(
        created.id,
        payload({ title: 'Editada', discountPercentage: 35, minNights: null }),
      );
      expect(edited).toMatchObject({
        title: 'Editada',
        discountPercentage: 35,
        minNights: null,
      });

      const row = await em.fork().findOneOrFail(Promotion, { id: created.id });
      expect(row.discountPercentage).toBe(35);
      expect(row.minNights).toBeNull();
    });

    it('rechaza fechas invertidas, noches en spa y crear una ya vencida', async () => {
      await expect(
        service.create(payload({ endDate: isoDay(-5) })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(payload({ target: PromotionTarget.SPA, minNights: 2 })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(payload({ startDate: isoDay(-9), endDate: isoDay(-5) })),
      ).rejects.toThrow('La fecha de fin ya pasó');
    });

    it('filtra por estado (CA3)', async () => {
      const active = await newPromotion();
      const scheduled = await newPromotion({
        startDate: isoDay(5),
        endDate: isoDay(9),
      });
      const expired = await seedPromotion({
        startDate: isoDay(-9),
        endDate: isoDay(-5),
      });
      const disabled = await newPromotion();
      await service.setEnabled(disabled.id, false);

      const idsWith = async (status: PromotionStatus) => {
        const { data } = await service.list({
          status,
          page: 1,
          pageSize: 100,
        });
        expect(data.every((row) => row.status === status)).toBe(true);
        return data.map((row) => row.id);
      };

      expect(await idsWith(PromotionStatus.ACTIVE)).toContain(active.id);
      expect(await idsWith(PromotionStatus.SCHEDULED)).toContain(scheduled.id);
      expect(await idsWith(PromotionStatus.EXPIRED)).toContain(expired.id);
      expect(await idsWith(PromotionStatus.DISABLED)).toContain(disabled.id);
    });

    it('la promoción vence sola: el estado sale de las fechas', async () => {
      const promotion = await newPromotion();

      const { data } = await service.list(
        { page: 1, pageSize: 100 },
        new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      );

      expect(data.find((row) => row.id === promotion.id)?.status).toBe(
        PromotionStatus.EXPIRED,
      );
    });

    it('avisa cuando la promoción no existe', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';

      await expect(service.remove(missing)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.setEnabled(missing, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('qué ofrece Chamber (CA2 y CA4)', () => {
    it('informa las vigentes y no las programadas', async () => {
      const active = await newPromotion();
      const scheduled = await newPromotion({
        startDate: isoDay(5),
        endDate: isoDay(9),
      });

      const block = await service.getChatBlock();

      expect(block).toContain(active.title);
      expect(block).not.toContain(scheduled.title);
    });

    it('deja de ofrecer la deshabilitada, la eliminada y la vencida', async () => {
      const disabled = await newPromotion();
      const removed = await newPromotion();
      const expired = await seedPromotion({
        startDate: isoDay(-9),
        endDate: isoDay(-5),
      });
      await service.setEnabled(disabled.id, false);
      await service.remove(removed.id);

      const block = await service.getChatBlock();

      expect(block).not.toContain(disabled.title);
      expect(block).not.toContain(removed.title);
      expect(block).not.toContain(expired.title);
    });

    it('volver a habilitarla la ofrece de nuevo', async () => {
      const promotion = await newPromotion();
      await service.setEnabled(promotion.id, false);
      await service.setEnabled(promotion.id, true);

      expect(await service.getChatBlock()).toContain(promotion.title);
    });
  });

  describe('cotización y confirmación (CA4 y CA5)', () => {
    it('cotiza con el descuento y las condiciones, y registra la promoción y el precio final', async () => {
      const promotion = await newPromotion({
        discountPercentage: 25,
        minNights: 3,
      });

      const { telegramUserId, booking, reply } = await quote(4);
      expect(reply).toContain(`Promoción <b>${promotion.title}</b>: 25%`);
      expect(reply).toContain('mínimo 3 noches');
      expect(reply).toContain(
        'sería de <b>$30000</b> (antes $40000, ahorrás $10000), con una seña del 30% de $9000',
      );

      const confirmation = await confirm(telegramUserId, booking);
      expect(confirmation).toContain('<b>$30000</b>');
      expect(confirmation).toContain('Seña para reservarla: $9000');

      const saved = await savedReservation(telegramUserId);
      expect(Number(saved.totalAmount)).toBe(30000);
      expect(Number(saved.depositAmount)).toBe(9000);
      expect(Number(saved.discountAmount)).toBe(10000);
      expect(saved.promotionTitle).toBe(promotion.title);
      expect(saved.promotionPercentage).toBe(25);
      expect(saved.promotion?.id).toBe(promotion.id);
    });

    it('sin cumplir el mínimo de noches cotiza a precio de lista', async () => {
      await newPromotion({ minNights: 5 });

      const { telegramUserId, booking, reply } = await quote(2);
      expect(reply).not.toContain('Promoción');
      expect(reply).toContain('sería de $20000');

      await confirm(telegramUserId, booking);
      const saved = await savedReservation(telegramUserId);
      expect(Number(saved.discountAmount)).toBe(0);
      expect(saved.promotionTitle).toBeNull();
    });

    it('una promoción de spa no descuenta habitaciones', async () => {
      await newPromotion({ target: PromotionTarget.SPA });

      const { reply } = await quote(2);

      expect(reply).not.toContain('Promoción');
    });

    it('si corresponden varias, aplica solo la de mayor beneficio (CA5)', async () => {
      await newPromotion({ discountPercentage: 10 });
      const best = await newPromotion({ discountPercentage: 30 });
      await newPromotion({ discountPercentage: 20 });

      const { telegramUserId, booking, reply } = await quote(2);
      expect(reply).toContain(best.title);
      expect(reply).toContain('sería de <b>$14000</b>');

      await confirm(telegramUserId, booking);
      expect((await savedReservation(telegramUserId)).promotionTitle).toBe(
        best.title,
      );
    });

    it('si la promoción se cae entre la oferta y la confirmación, avisa antes de reservar', async () => {
      const promotion = await newPromotion();
      const { telegramUserId, booking } = await quote(2);
      await service.setEnabled(promotion.id, false);

      const warning = await confirm(telegramUserId, booking);
      await orm.em.flush();

      expect(warning).toContain('el precio cambió');
      expect(warning).toContain('ahora es de $20000');
      expect(createPreference).not.toHaveBeenCalled();
      expect(await em.fork().count(Reservation, { telegramUserId })).toBe(0);

      // El huésped acepta el precio nuevo: la segunda vez sí reserva.
      await confirm(telegramUserId, booking);
      const saved = await savedReservation(telegramUserId);
      expect(Number(saved.totalAmount)).toBe(20000);
      expect(saved.promotionTitle).toBeNull();
    });

    it('las fechas alternativas también salen con el descuento y dicen qué promoción aplica', async () => {
      const promotion = await newPromotion({ discountPercentage: 10 });
      const checkIn = nextDay;
      nextDay += 20;
      const fork = em.fork();
      await fork
        .persist(
          fork.create(Reservation, {
            room: fork.getReference(Room, room.id),
            // mediodía local: el día calendario no se corre con ninguna zona horaria
            checkIn: new Date(2099, 4, checkIn, 12),
            checkOut: new Date(2099, 4, checkIn + 3, 12),
            status: ReservationStatus.CONFIRMED,
            telegramUserId: newGuest(),
            totalAmount: 30000,
            depositAmount: 9000,
            guestFullName: 'Ocupa la habitación',
            guestDni: '30111222',
          }),
        )
        .flush();

      const result = await reservations.searchAvailability(newGuest(), null, {
        checkIn: d(checkIn),
        checkOut: d(checkIn + 3),
        capacity: CAPACITY,
      });
      await orm.em.flush();

      if (result.available) throw new Error('Se esperaban alternativas');
      expect(result.alternatives.length).toBeGreaterThan(0);
      for (const alternative of result.alternatives) {
        expect(alternative.totalAmount).toBe(alternative.nights * PRICE * 0.9);
        expect(alternative.promotion).toBe(
          `${promotion.title} (10% de descuento)`,
        );
      }
    });

    it('eliminar la promoción no toca las reservas que ya la usaron', async () => {
      const promotion = await newPromotion();
      const { telegramUserId, booking } = await quote(2);
      await confirm(telegramUserId, booking);
      await orm.em.flush();

      await service.remove(promotion.id);

      const saved = await em
        .fork()
        .findOneOrFail(Reservation, { telegramUserId });
      expect(saved.promotion).toBeNull();
      expect(saved.promotionTitle).toBe(promotion.title);
      expect(Number(saved.totalAmount)).toBe(16000);
      expect(Number(saved.discountAmount)).toBe(4000);
    });
  });

  describe('cancelación (CA6)', () => {
    it('la devolución se calcula sobre la seña abonada, ya con el descuento', async () => {
      await newPromotion({ discountPercentage: 50 });
      const { telegramUserId, booking } = await quote(2);
      await confirm(telegramUserId, booking);
      const saved = await savedReservation(telegramUserId);
      await em.nativeUpdate(
        Reservation,
        { id: saved.id },
        { status: ReservationStatus.CONFIRMED },
      );

      const outcome = await app
        .get(CancellationService)
        .cancelReservation(saved.id);

      // Total $20000 - 50% = $10000; seña $3000; la política devuelve el 50%.
      expect(outcome.refundPercentage).toBe(50);
      expect(outcome.refundAmount).toBe(1500);
    });
  });

  describe('spa', () => {
    /** 15/03/2099 12:00 en Buenos Aires. La promoción se siembra vigente para ese día. */
    const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
    const seedSpaPromotion = () =>
      seedPromotion({
        target: PromotionTarget.SPA,
        startDate: '2099-03-01',
        endDate: '2099-03-31',
        discountPercentage: 20,
      });

    it('cobra el precio con descuento al cliente externo y lo registra', async () => {
      const promotion = await seedSpaPromotion();
      const telegramUserId = newGuest();

      const result = await app.get(SpaReservationService).requestSpa(
        telegramUserId,
        {
          serviceId: spa.id,
          date: '16-03-2099',
          time: '11:00',
          fullName: 'Beto Externo',
          dni: '28111222',
        },
        NOW,
      );

      expect(result.ok).toBe(true);
      expect(result.ok && result.reply).toContain(
        'Total: <b>$12000</b> (antes $15000, ahorrás $3000)',
      );
      expect(createSpaPreference).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 12000 }),
      );

      const saved = await em
        .fork()
        .findOneOrFail(SpaReservation, { telegramUserId });
      expect(Number(saved.amount)).toBe(12000);
      expect(Number(saved.discountAmount)).toBe(3000);
      expect(saved.promotionTitle).toBe(promotion.title);
    });

    it('el precio con descuento también figura en el bloque de Chamber', async () => {
      const promotion = await newPromotion({
        target: PromotionTarget.SPA,
      });

      const block = await app
        .get(SpaCatalogService)
        .getSpaContextBlock(newGuest());

      expect(block).toContain(
        `$12000 con la promoción ${promotion.title} (precio de lista $15000)`,
      );
    });
  });

  describe('indicadores de ingresos (CA5)', () => {
    it('suma el descuento de lo confirmado: reservas y turnos de spa', async () => {
      const statistics = app.get(StatisticsService);
      const before = (await statistics.getStatistics('all')).revenue;

      await newPromotion({ discountPercentage: 25 });
      const confirmed = await quote(2);
      await confirm(confirmed.telegramUserId, confirmed.booking);
      const reservation = await savedReservation(confirmed.telegramUserId);
      await em.nativeUpdate(
        Reservation,
        { id: reservation.id },
        { status: ReservationStatus.CONFIRMED },
      );

      const unpaid = await quote(2);
      await confirm(unpaid.telegramUserId, unpaid.booking);
      await orm.em.flush();

      const spaClient = newGuest();
      const fork = em.fork();
      await fork
        .persist(
          fork.create(SpaReservation, {
            status: SpaReservationStatus.CONFIRMED,
            telegramUserId: spaClient,
            spaService: fork.getReference(SpaService, spa.id),
            serviceName: spa.name,
            guestFullName: 'Beto Externo',
            requestedDate: '2099-03-16',
            requestedTime: '11:00',
            amount: 12000,
            discountAmount: 3000,
          }),
        )
        .flush();

      const after = (await statistics.getStatistics('all')).revenue;

      expect(after.promotionDiscounts - before.promotionDiscounts).toBe(8000);
      expect(after.promotionSales - before.promotionSales).toBe(2);
    });
  });
});
