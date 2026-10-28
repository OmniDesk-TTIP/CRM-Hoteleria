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
import { ReservationExpirationService } from './reservationExpiration.service';
import { toDayNumber } from './reservation.model';
import { formatDate } from '../bookingProcess/date.util';
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
 * Flujo del bot (US-7 y US-12) contra la base de test: reservas, habitaciones y procesos de reserva
 * son filas reales; Mercado Pago, Gemini y Telegram están simulados. Las reglas puras del hueco están en reservation.model.spec.ts; acá se prueba el flujo completo del service.
 * Todo ocurre en octubre de 2099 (nunca es "pasado"). Las dos habitaciones de prueba se distinguen por capacidad, así cada test elige con quién compite:
 * - pidiendo 92 personas solo califica la habitación B;
 * - pidiendo 91 califican la A y la B.
 */
describe('ReservationService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: ReservationService;
  let adminService: ReservationAdminService;

  const createPreference = jest.fn();
  const sendMessage = jest.fn().mockResolvedValue({});

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

  const seedReservationOn = async (
    room: Room,
    checkIn: Date,
    checkOut: Date,
  ) => {
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, room.id),
      checkIn,
      checkOut,
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

  const seedReservation = (room: Room, from: number, to: number) => {
    const day = (n: number) => new Date(2099, 9, n, 12); // mediodía local
    return seedReservationOn(room, day(from), day(to));
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
        action: jest.fn(),
        telegram: { sendMessage },
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
      expect(booking.step).toBe(BookingProcessStep.IN_PROGRESS);
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

    it('una reserva cargada desde el panel (fechas a medianoche UTC) bloquea exactamente sus noches', async () => {
      const created = await adminService.create({
        guestFullName: 'Cliente Manual',
        guestDni: '30111222',
        roomId: roomB.id,
        checkIn: '2099-10-10',
        checkOut: '2099-10-15',
        status: ReservationStatus.CONFIRMED,
        totalAmount: 5 * PRICE_B,
        depositAmount: 30000,
      });
      reservationIds.push(created.id);

      const { result } = await search(ONLY_ROOM_B, 10, 15);

      expect(alternativesOf(result).map((a) => a.checkIn)).toEqual([
        d(15),
        d(5),
        d(17),
      ]);
    });

    it('no ofrece alternativas que empiecen antes de hoy', async () => {
      const now = new Date();
      const fromToday = (days: number) =>
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 12);
      await seedReservationOn(roomB, fromToday(2), fromToday(7));

      const result = await service.searchAvailability(
        (await newBooking()).telegramUserId,
        null,
        {
          checkIn: formatDate(fromToday(2)),
          checkOut: formatDate(fromToday(7)),
          capacity: ONLY_ROOM_B,
        },
      );

      expect(alternativesOf(result).map((a) => a.checkIn)).toEqual(
        [7, 9, 8].map((days) => formatDate(fromToday(days))),
      );
    });
  });

  describe('US-7 – estadías más cortas como alternativa', () => {
    it('prioriza una estadía más corta que se superpone con lo pedido antes que las completas corridas', async () => {
      await seedReservation(roomB, 9, 12);

      const { result } = await search(ONLY_ROOM_B, 10, 15);

      expect(alternativesOf(result)).toEqual([
        {
          checkIn: d(12),
          checkOut: d(16),
          nights: 4,
          isShorterStay: true,
          roomCategory: categoryB.name,
          totalAmount: 4 * PRICE_B,
        },
        {
          checkIn: d(12),
          checkOut: d(17),
          nights: 5,
          isShorterStay: false,
          roomCategory: categoryB.name,
          totalAmount: 5 * PRICE_B,
        },
        {
          checkIn: d(14),
          checkOut: d(19),
          nights: 5,
          isShorterStay: false,
          roomCategory: categoryB.name,
          totalAmount: 5 * PRICE_B,
        },
      ]);
    });

    it('completa con más estadías cortas cuando no hay suficientes completas', async () => {
      await seedReservation(roomA, 1, 11);
      await seedReservation(roomA, 15, 30);
      await seedReservation(roomB, 1, 10);
      await seedReservation(roomB, 13, 30);

      const { result } = await search(ROOMS_A_AND_B, 10, 15);

      expect(alternativesOf(result)).toEqual([
        expect.objectContaining({
          checkIn: d(11),
          checkOut: d(15),
          isShorterStay: true,
          roomCategory: categoryA.name,
        }),
        expect.objectContaining({
          checkIn: d(10),
          checkOut: d(13),
          isShorterStay: true,
          roomCategory: categoryB.name,
        }),
      ]);
    });

    it('no ofrece estadías por debajo de la mitad de las noches pedidas', async () => {
      await seedReservation(roomB, 1, 9);
      await seedReservation(roomB, 11, 30);

      const { result } = await search(ONLY_ROOM_B, 10, 17);

      expect(alternativesOf(result)).toEqual([]);
    });
  });

  describe('US-12 – oferta y confirmación', () => {
    it('la oferta y la reserva calculan el total y la seña del 30%, y la respuesta trae el link de pago', async () => {
      const { result, booking } = await search(ONLY_ROOM_B, 10, 14);
      expect(offerOf(result)).toContain(
        `El total de tu estadía (4 noches) sería de $${4 * PRICE_B}, con una seña del 30% de $${0.3 * 4 * PRICE_B}`,
      );

      const reply = await service.confirmReservation(
        booking.telegramUserId,
        booking,
        { fullName: 'Ana Pagadora', dni: '30111222' },
      );
      await orm.em.flush();

      const [saved] = await em.fork().find(Reservation, {
        telegramUserId: booking.telegramUserId,
      });
      expect(Number(saved.depositAmount)).toBe(0.3 * 4 * PRICE_B);
      expect(reply).toContain(`Total de la estadía: $${4 * PRICE_B}`);
      expect(reply).toContain(`Seña para reservarla: $${0.3 * 4 * PRICE_B}`);
      expect(reply).toContain(
        `${process.env.FRONTEND_BASE_URL}/payment/form/${saved.id}`,
      );
    });

    it('si Mercado Pago falla, propaga el error y no deja la reserva guardada', async () => {
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      createPreference.mockRejectedValueOnce(
        new Error('Mercado Pago no responde'),
      );

      await expect(
        service.confirmReservation(booking.telegramUserId, booking, {
          fullName: 'Ana Sin Pago',
          dni: '30111222',
        }),
      ).rejects.toThrow('Mercado Pago no responde');
      // El manejo de errores de Telegram hace flush (para contar el fallo del bot): no tiene que
      // arrastrar la reserva a medio hacer ni dar por terminada la búsqueda.
      await orm.em.flush();
      expect(
        await em
          .fork()
          .count(Reservation, { telegramUserId: booking.telegramUserId }),
      ).toBe(0);
      expect(
        (
          await em
            .fork()
            .findOneOrFail(
              BookingProcess,
              { id: booking.id },
              { refresh: true },
            )
        ).step,
      ).toBe(BookingProcessStep.PENDING_CONFIRMATION);
    });

    it('después de un error de Mercado Pago se puede volver a confirmar', async () => {
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      createPreference.mockRejectedValueOnce(
        new Error('Mercado Pago no responde'),
      );
      const guest = { fullName: 'Ana Reintenta', dni: '30111222' };
      await expect(
        service.confirmReservation(booking.telegramUserId, booking, guest),
      ).rejects.toThrow();
      await orm.em.flush();

      const reply = await service.confirmReservation(
        booking.telegramUserId,
        booking,
        guest,
      );
      await orm.em.flush();

      expect(reply).toContain('Aboná la seña acá:');
      expect(
        await em
          .fork()
          .count(Reservation, { telegramUserId: booking.telegramUserId }),
      ).toBe(1);
    });

    it('reenvía el link de pago de la reserva que espera la seña', async () => {
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      expect(await service.hasPendingPayment(booking.telegramUserId)).toBe(
        false,
      );
      await service.confirmReservation(booking.telegramUserId, booking, {
        fullName: 'Ana Link',
        dni: '30111222',
      });
      await orm.em.flush();
      const [saved] = await em
        .fork()
        .find(Reservation, { telegramUserId: booking.telegramUserId });

      expect(await service.hasPendingPayment(booking.telegramUserId)).toBe(
        true,
      );
      const reply = await service.buildPendingPaymentReply(
        booking.telegramUserId,
      );
      expect(reply).toContain(
        `${process.env.FRONTEND_BASE_URL}/payment/form/${saved.id}`,
      );
      expect(reply).toContain(`$${0.3 * 4 * PRICE_B}`);
      expect(reply).toContain('minutos más');
    });

    it('no reenvía links de reservas vencidas, pagadas o sin link', async () => {
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      await service.confirmReservation(booking.telegramUserId, booking, {
        fullName: 'Ana Vencida',
        dni: '30111222',
      });
      await orm.em.flush();
      const later = new Date(Date.now() + 31 * 60 * 1000);

      expect(
        await service.buildPendingPaymentReply(booking.telegramUserId, later),
      ).toBeNull();

      await em.nativeUpdate(
        Reservation,
        { telegramUserId: booking.telegramUserId },
        { mpInitPoint: null },
      );
      expect(await service.hasPendingPayment(booking.telegramUserId)).toBe(
        false,
      );
    });
  });

  describe('US-22 – vencimiento y recupero de reservas pendientes', () => {
    const MINUTE = 60 * 1000;

    /** Reserva del bot en la habitación B del 10 al 14 de octubre de 2099. */
    const seedBotReservation = async (
      overrides: Partial<Reservation> = {},
    ): Promise<Reservation> => {
      const telegramUserId = `tg-us22-${next()}`;
      guestIds.push(telegramUserId);
      const reservation = em.create(Reservation, {
        room: em.getReference(Room, roomB.id),
        telegramUserId,
        checkIn: new Date(2099, 9, 10, 12),
        checkOut: new Date(2099, 9, 14, 12),
        status: ReservationStatus.PENDING_PAYMENT,
        totalAmount: 4 * PRICE_B,
        depositAmount: 0.3 * 4 * PRICE_B,
        guestFullName: 'Ana Vence',
        guestDni: '30111222',
        mpInitPoint: 'https://mp.example/pref-us22',
        expiresAt: new Date(Date.now() + 30 * MINUTE),
        ...overrides,
      });
      em.persist(reservation);
      await em.flush();
      reservationIds.push(reservation.id);
      return reservation;
    };

    const reload = (id: string) =>
      em.fork().findOneOrFail(Reservation, { id }, { refresh: true });

    let expirationService: ReservationExpirationService;
    beforeAll(() => {
      expirationService = app.get(ReservationExpirationService);
    });
    beforeEach(() => sendMessage.mockClear());

    it('CA1: la reserva que toma el bot vence a los 30 minutos', async () => {
      const { booking } = await search(ONLY_ROOM_B, 10, 14);
      const before = Date.now();
      await service.confirmReservation(booking.telegramUserId, booking, {
        fullName: 'Ana Plazo',
        dni: '30111222',
      });
      await orm.em.flush();

      const [saved] = await em
        .fork()
        .find(Reservation, { telegramUserId: booking.telegramUserId });
      const expiresIn = saved.expiresAt!.getTime() - before;
      expect(expiresIn).toBeGreaterThanOrEqual(30 * MINUTE - 1000);
      expect(expiresIn).toBeLessThanOrEqual(30 * MINUTE + 5000);
    });

    it('CA2: al vencer pasa a EXPIRED y libera la habitación', async () => {
      const overdue = await seedBotReservation({
        expiresAt: new Date(Date.now() - MINUTE),
      });

      await expirationService.expireOverdue(new Date());

      expect((await reload(overdue.id)).status).toBe(ReservationStatus.EXPIRED);
      const { result } = await search(ONLY_ROOM_B, 10, 14);
      expect(offerOf(result)).toContain(PLAIN_OFFER);
      expect(sendMessage).toHaveBeenCalledWith(
        overdue.telegramUserId,
        expect.stringContaining('venció'),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
    });

    it('CA2 y CA5: no vence las que tienen plazo ni las confirmadas', async () => {
      const onTime = await seedBotReservation();
      const confirmed = await seedBotReservation({
        status: ReservationStatus.CONFIRMED,
        expiresAt: new Date(Date.now() - MINUTE),
        checkIn: new Date(2099, 9, 20, 12),
        checkOut: new Date(2099, 9, 22, 12),
      });

      await expirationService.expireOverdue(new Date());

      expect((await reload(onTime.id)).status).toBe(
        ReservationStatus.PENDING_PAYMENT,
      );
      expect((await reload(confirmed.id)).status).toBe(
        ReservationStatus.CONFIRMED,
      );
    });

    it('CA3: manda un solo recordatorio cuando faltan menos de 10 minutos', async () => {
      const now = new Date();
      const soon = await seedBotReservation({
        expiresAt: new Date(now.getTime() + 8 * MINUTE),
      });
      await seedBotReservation({
        expiresAt: new Date(now.getTime() + 25 * MINUTE),
        checkIn: new Date(2099, 9, 20, 12),
        checkOut: new Date(2099, 9, 22, 12),
      });

      await expirationService.sendReminders(now);
      await expirationService.sendReminders(now);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        soon.telegramUserId,
        expect.stringContaining('8 minutos'),
        { parse_mode: 'HTML' },
      );
      expect((await reload(soon.id)).reminderSentAt).toBeTruthy();
    });

    it('CA4: si la habitación sigue libre, la retoma con los mismos datos y un plazo nuevo', async () => {
      const expired = await seedBotReservation({
        status: ReservationStatus.EXPIRED,
        expiresAt: new Date(Date.now() - MINUTE),
      });

      const result = await service.resumeExpiredReservation(
        expired.telegramUserId!,
        expired.id,
      );
      await orm.em.flush();

      expect(result.kind).toBe('reply');
      const reservations = await em.fork().find(Reservation, {
        telegramUserId: expired.telegramUserId,
        status: ReservationStatus.PENDING_PAYMENT,
      });
      expect(reservations).toHaveLength(1);
      expect(reservations[0].room.id).toBe(roomB.id);
      expect(reservations[0].guestFullName).toBe('Ana Vence');
      expect(Number(reservations[0].depositAmount)).toBe(0.3 * 4 * PRICE_B);
      expect(reservations[0].expiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect((await reload(expired.id)).recoveryAnsweredAt).toBeTruthy();

      const again = await service.resumeExpiredReservation(
        expired.telegramUserId!,
        expired.id,
      );
      expect(again).toEqual({
        kind: 'reply',
        reply: expect.stringContaining('Ya me respondiste'),
      });
    });

    it('CA4: si la habitación se ocupó, pide buscar alternativas para las mismas fechas', async () => {
      const expired = await seedBotReservation({
        status: ReservationStatus.EXPIRED,
      });
      await seedReservation(roomB, 12, 16);

      const result = await service.resumeExpiredReservation(
        expired.telegramUserId!,
        expired.id,
      );

      expect(result).toEqual({
        kind: 'search',
        search: { checkIn: d(10), checkOut: d(14), capacity: ONLY_ROOM_B },
      });
      expect(createPreference).not.toHaveBeenCalled();
    });

    it('CA4: no deja retomar la reserva de otro huésped', async () => {
      const expired = await seedBotReservation({
        status: ReservationStatus.EXPIRED,
      });

      const result = await service.resumeExpiredReservation(
        'otro-huesped',
        expired.id,
      );

      expect(result).toEqual({
        kind: 'reply',
        reply: expect.stringContaining('ya no se puede retomar'),
      });
      expect((await reload(expired.id)).recoveryAnsweredAt).toBeFalsy();
    });

    it('CA7: una vencida no se cancela ni genera devolución', async () => {
      const expired = await seedBotReservation({
        status: ReservationStatus.EXPIRED,
      });

      await expect(adminService.cancel(expired.id)).rejects.toThrow(
        'venció por falta de pago',
      );
      const row = await reload(expired.id);
      expect(row.status).toBe(ReservationStatus.EXPIRED);
      expect(row.refundAmount).toBeNull();
    });
  });

  describe('US-4 CA4 – habitaciones deshabilitadas', () => {
    it('nunca ofrece una habitación INACTIVE, ni en la oferta ni en las alternativas', async () => {
      await seedReservation(roomB, 10, 14);
      await em.nativeUpdate(
        Room,
        { id: roomA.id },
        { status: RoomStatus.INACTIVE },
      );

      try {
        const { result } = await search(ROOMS_A_AND_B, 10, 14);

        const alternatives = alternativesOf(result);
        expect(alternatives.length).toBeGreaterThan(0);
        expect(
          alternatives.every((a) => a.roomCategory === categoryB.name),
        ).toBe(true);
      } finally {
        await em.nativeUpdate(
          Room,
          { id: roomA.id },
          { status: RoomStatus.ACTIVE },
        );
      }
    });
  });
});
