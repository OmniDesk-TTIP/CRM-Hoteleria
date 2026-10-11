import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import {
  ReservationService,
  type AvailabilityResult,
} from './reservation.service';
import { ReservationAdminService } from './reservation-admin.service';
import { toDayNumber } from './reservation.model';
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

/**
 * US-12 contra la base de test: reservas, habitaciones y procesos de reserva son filas reales;
 * Mercado Pago, Gemini y Telegram están simulados. Las reglas puras del hueco están en reservation.model.spec.ts; acá se prueba el flujo completo del service.
 * Todo ocurre en octubre de 2099 (nunca es "pasado"). Las dos habitaciones de prueba se distinguen por capacidad, así cada test elige con quién compite:
 * - pidiendo 92 personas solo califica la habitación B;
 * - pidiendo 91 califican la A y la B.
 */
describe('ReservationService – noches sueltas (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: ReservationService;
  let adminService: ReservationAdminService;

  const createPreference = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const ONLY_ROOM_B = 92;
  const ROOMS_A_AND_B = 91;
  const PRICE_B = 20000;

  let categoryA: RoomCategory;
  let categoryB: RoomCategory;
  let roomA: Room;
  let roomB: Room;

  const reservationIds: string[] = [];
  const bookingIds: string[] = [];
  const guestIds: string[] = [];

  /** DD-MM-YYYY de un día de octubre de 2099, el formato que usa el bot. */
  const d = (day: number) => `${String(day).padStart(2, '0')}-10-2099`;

  const seedReservation = async (room: Room, from: number, to: number) => {
    const day = (n: number) => new Date(2099, 9, n, 12); // mediodía local
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, room.id),
      checkIn: day(from),
      checkOut: day(to),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Huésped Previo',
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    reservationIds.push(reservation.id);
  };

  const newBooking = async (
    overrides: Partial<BookingProcess> = {},
  ): Promise<BookingProcess> => {
    const telegramUserId = `tg-us12-${next()}`;
    guestIds.push(telegramUserId);
    const booking = orm.em.create(BookingProcess, {
      telegramUserId,
      step: BookingProcessStep.IN_PROGRESS,
      ...overrides,
    });
    await orm.em.flush();
    bookingIds.push(booking.id);
    return booking;
  };

  const search = async (
    capacity: number,
    checkIn: number,
    checkOut: number,
    existing?: BookingProcess,
  ): Promise<{ result: AvailabilityResult; booking: BookingProcess }> => {
    const booking = existing ?? (await newBooking());
    const result = await service.searchAvailability(
      booking.telegramUserId,
      booking,
      { checkIn: d(checkIn), checkOut: d(checkOut), capacity },
    );
    return { result, booking };
  };

  /** Oferta normal de una habitación, sin variantes de fechas. */
  const PLAIN_OFFER = '¿Querés que te la reserve?';
  /** Encabezado de la oferta que muestra directamente fechas cercanas sin hueco. */
  const VARIANTS_OFFER = 'Tenemos disponibilidad en estas opciones:';

  const offerOf = (result: AvailabilityResult): string => {
    if (!result.available) throw new Error('Se esperaba una oferta');
    return result.reply;
  };

  const alternativesOf = (result: AvailabilityResult) => {
    if (result.available) throw new Error('Se esperaban alternativas');
    return result.alternatives;
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

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(ReservationService);
    adminService = app.get(ReservationAdminService);

    categoryA = em.create(RoomCategory, {
      name: `US12 Categoría A ${suffix}`,
      capacity: ROOMS_A_AND_B,
      basePrice: 10000,
    });
    categoryB = em.create(RoomCategory, {
      name: `US12 Categoría B ${suffix}`,
      capacity: ONLY_ROOM_B,
      basePrice: PRICE_B,
    });
    roomA = em.create(Room, {
      roomNumber: `US12-A-${suffix}`,
      category: categoryA,
      status: RoomStatus.ACTIVE,
    });
    roomB = em.create(Room, {
      roomNumber: `US12-B-${suffix}`,
      category: categoryB,
      status: RoomStatus.ACTIVE,
    });
    em.persist([categoryA, categoryB, roomA, roomB]);
    await em.flush();
  });

  beforeEach(() => {
    // El service usa el EntityManager global: sin esto podría devolver filas cacheadas de otro test.
    orm.em.clear();
    createPreference.mockReset();
    createPreference.mockResolvedValue({
      preferenceId: 'pref-us12',
      initPoint: 'https://mp.example/pref-us12',
    });
  });

  afterEach(async () => {
    try {
      await em.nativeDelete(Reservation, {
        $or: [
          { id: { $in: reservationIds.splice(0) } },
          { telegramUserId: { $in: guestIds } },
        ],
      });
      await em.nativeDelete(BookingProcess, {
        id: { $in: bookingIds.splice(0) },
      });
    } catch {
      // no-op: limpieza best-effort
    }
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Room, { id: { $in: [roomA.id, roomB.id] } });
      await em.nativeDelete(RoomCategory, {
        id: { $in: [categoryA.id, categoryB.id] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('CA1 y CA3 – detección y variantes cercanas', () => {
    it('ofrece fechas cercanas sin explicar el hueco cuando las pedidas dejarían una noche suelta', async () => {
      await seedReservation(roomB, 15, 20);

      const { result, booking } = await search(ONLY_ROOM_B, 10, 14);

      const reply = offerOf(result);
      expect(reply).toContain(VARIANTS_OFFER);
      expect(reply).toContain(
        `${categoryB.name}: del ${d(11)} al ${d(15)} (4 noches), total $${4 * PRICE_B}`,
      );
      expect(reply).toContain(
        `${categoryB.name}: del ${d(10)} al ${d(15)} (5 noches), total $${5 * PRICE_B}`,
      );
      // Sin mencionar el hueco ni ofrecer todavía las fechas originales.
      expect(reply).not.toContain('suelta');
      expect(reply).not.toContain(`al ${d(14)}`);
      expect(reply).not.toContain(PLAIN_OFFER);
      // Todavía no se ofreció ninguna habitacion
      expect(booking.step).toBe(BookingProcessStep.IN_PROGRESS);
      expect(booking.checkIn).toBe(d(10));
      expect(booking.checkOut).toBe(d(14));
    });

    it('detecta el hueco anterior y ofrece llegar un día antes o correr para atrás', async () => {
      await seedReservation(roomB, 5, 9);

      const { result } = await search(ONLY_ROOM_B, 10, 13);

      const reply = offerOf(result);
      expect(reply).toContain(VARIANTS_OFFER);
      expect(reply).toContain(
        `${categoryB.name}: del ${d(9)} al ${d(12)} (3 noches)`,
      );
      expect(reply).toContain(
        `${categoryB.name}: del ${d(9)} al ${d(13)} (4 noches)`,
      );
    });

    it('no menciona nada si las fechas quedan pegadas a la otra reserva', async () => {
      await seedReservation(roomB, 14, 20);

      const { result } = await search(ONLY_ROOM_B, 10, 14);

      expect(offerOf(result)).toContain(PLAIN_OFFER);
    });

    it('dos noches libres no son un hueco: se pueden vender', async () => {
      await seedReservation(roomB, 16, 20);

      const { result } = await search(ONLY_ROOM_B, 10, 14);

      expect(offerOf(result)).toContain(PLAIN_OFFER);
    });

    it('ignora las reservas canceladas al buscar huecos', async () => {
      await seedReservation(roomB, 15, 20);
      await em.nativeUpdate(
        Reservation,
        { id: { $in: reservationIds } },
        { status: ReservationStatus.CANCELLED },
      );

      const { result } = await search(ONLY_ROOM_B, 10, 14);

      expect(offerOf(result)).toContain(PLAIN_OFFER);
    });
  });

  describe('CA2 – prioridad de las opciones sin hueco', () => {
    it('ofrece la habitación que no deja hueco si hay otra equivalente', async () => {
      await seedReservation(roomA, 15, 20);

      const { result } = await search(ROOMS_A_AND_B, 10, 14);

      const reply = offerOf(result);
      expect(reply).toContain(`nuestra ${categoryB.name} del ${d(10)}`);
      expect(reply).toContain(PLAIN_OFFER);
    });

    it('lo mismo con las habitaciones al revés', async () => {
      await seedReservation(roomB, 15, 20);

      const { result } = await search(ROOMS_A_AND_B, 10, 14);

      const reply = offerOf(result);
      expect(reply).toContain(`nuestra ${categoryA.name} del ${d(10)}`);
      expect(reply).toContain(PLAIN_OFFER);
    });

    it('en las alternativas deja para el final las que dejan una noche suelta', async () => {
      await seedReservation(roomB, 10, 15);

      const { result } = await search(ONLY_ROOM_B, 10, 15);

      const alternatives = alternativesOf(result);
      // El 16 dejaría libre solo la noche del 15, junto a la reserva que termina ese día.
      expect(alternatives.map((a) => a.checkIn)).toEqual([d(15), d(5), d(17)]);
    });

    it('para unas mismas fechas ofrece la habitación que no deja hueco', async () => {
      await seedReservation(roomA, 10, 15);
      await seedReservation(roomB, 9, 16);

      const { result } = await search(ROOMS_A_AND_B, 10, 15);

      const alternatives = alternativesOf(result);
      expect(alternatives.map((a) => a.checkIn)).toEqual([d(15), d(5), d(16)]);
      // El 16 dejaría una noche suelta en la A pero queda pegado a la reserva de la B.
      expect(alternatives[2].roomCategory).toBe(categoryB.name);
    });
  });

  describe('CA4 – el huésped insiste en las fechas originales', () => {
    it('si vuelve a pedir las fechas originales, recibe la oferta normal y queda esperando confirmación', async () => {
      await seedReservation(roomB, 15, 20);
      const { result, booking } = await search(ONLY_ROOM_B, 10, 14);
      expect(offerOf(result)).toContain(VARIANTS_OFFER);

      const insisted = await search(ONLY_ROOM_B, 10, 14, booking);

      const reply = offerOf(insisted.result);
      expect(reply).toContain(
        `nuestra ${categoryB.name} del ${d(10)} al ${d(14)} por $${PRICE_B} la noche`,
      );
      expect(reply).toContain(PLAIN_OFFER);
      expect(reply).not.toContain(VARIANTS_OFFER);
      expect(booking.step).toBe(BookingProcessStep.PENDING_CONFIRMATION);
    });

    it('reserva las fechas originales aunque dejen una noche suelta', async () => {
      await seedReservation(roomB, 15, 20);
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      await search(ONLY_ROOM_B, 10, 14, booking);

      const reply = await service.confirmReservation(
        booking.telegramUserId,
        booking,
        { fullName: 'Ana Insistente', dni: '30111222' },
      );
      await orm.em.flush();

      expect(reply).toContain(
        `Te estoy guardando la ${categoryB.name} del ${d(10)} al ${d(14)}`,
      );
      const saved = await em.fork().find(Reservation, {
        telegramUserId: booking.telegramUserId,
      });
      expect(saved).toHaveLength(1);
      expect(saved[0].room.id).toBe(roomB.id);
      expect(saved[0].status).toBe(ReservationStatus.PENDING_PAYMENT);
      expect(toDayNumber(saved[0].checkIn)).toBe(toDayNumber('2099-10-10'));
      expect(toDayNumber(saved[0].checkOut)).toBe(toDayNumber('2099-10-14'));
      expect(Number(saved[0].totalAmount)).toBe(4 * PRICE_B);
    });

    it('si la habitación ya no está libre, no la reserva', async () => {
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      await seedReservation(roomB, 12, 16);

      const reply = await service.confirmReservation(
        booking.telegramUserId,
        booking,
        { fullName: 'Ana Insistente', dni: '30111222' },
      );

      expect(reply).toContain('alguien acaba de reservar');
      expect(createPreference).not.toHaveBeenCalled();
    });
  });

  describe('CA5 – reglas de la US-7 y carga manual', () => {
    it('sin disponibilidad, las alternativas siguen dentro de ±7 días y con las mismas noches', async () => {
      await seedReservation(roomB, 10, 15);

      const { result } = await search(ONLY_ROOM_B, 10, 15);

      const alternatives = alternativesOf(result);
      expect(alternatives.length).toBeGreaterThan(0);
      for (const alternative of alternatives) {
        const distance = Math.abs(
          toDayNumber(alternative.checkIn.split('-').reverse().join('-')) -
            toDayNumber('2099-10-10'),
        );
        expect(distance).toBeLessThanOrEqual(7);
        expect(alternative.nights).toBe(5);
        expect(alternative.isShorterStay).toBe(false);
      }
    });

    it('la carga manual desde el panel sigue permitiendo fechas que dejan una noche suelta', async () => {
      await seedReservation(roomB, 15, 20);

      const created = await adminService.create({
        guestFullName: 'Cliente Manual',
        guestDni: '30111222',
        roomId: roomB.id,
        checkIn: '2099-10-10',
        checkOut: '2099-10-14',
        status: ReservationStatus.CONFIRMED,
        totalAmount: 4 * PRICE_B,
        depositAmount: 24000,
      });
      reservationIds.push(created.id);

      expect(created.id).toBeDefined();
      expect(await em.fork().count(Reservation, { id: created.id })).toBe(1);
    });
  });
});