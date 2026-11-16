import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { ChatService } from '../chat/chat.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { RestaurantSettingsModel } from '../restaurant/model/restaurant.model';
import { SpaService } from '../spa/spa.service';
import { SpaServiceModel } from '../spa/model/spa.model';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { ArrivalMessageService } from './arrivalMessage.service';
import { ArrivalMessageRepository } from './arrivalMessage.repository';
import {
  ArrivalMessage,
  ArrivalMessageStatus,
  ArrivalMessageType,
} from '../../infrastructure/database/entities/ArrivalMessage.entity';
import {
  Reservation,
  ReservationOrigin,
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
import { RestaurantStatus } from '../../infrastructure/database/entities/RestaurantSettings.entity';

/**
 * Integración de ArrivalMessageService contra la base de test: reservas y mensajes son filas
 * reales; Telegram está simulado. "Hoy" lo fija cada test con `now`, en 2097 para no cruzarse con
 * las reservas de otras suites (el cron mira todas las reservas de ese día).
 *
 * Horario del hotel: Buenos Aires (UTC-3). 16:00 UTC = 13:00 en el hotel.
 */
describe('ArrivalMessageService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: ArrivalMessageService;
  let repository: ArrivalMessageRepository;

  const sendMessage = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  let categoryId: string;
  let roomId: string;
  const clientIds: string[] = [];
  const reservationIds: string[] = [];

  /** Cada test usa su propio día: las reservas de un test no le llegan al siguiente. */
  let dayOffset = 0;
  const nextCheckInDay = () => {
    dayOffset += 3;
    return new Date(Date.UTC(2097, 0, 10 + dayOffset))
      .toISOString()
      .slice(0, 10);
  };

  /** Instante en UTC de esa hora del hotel, `daysBefore` días antes del día indicado. */
  const hotelTime = (day: string, hour: number, daysBefore = 0) => {
    const [year, month, date] = day.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date - daysBefore, hour + 3));
  };

  /** Mediodía local: el día calendario no se corre con ninguna zona horaria. */
  const localDay = (iso: string, plusDays = 0) => {
    const [year, month, date] = iso.split('-').map(Number);
    return new Date(year, month - 1, date + plusDays, 12);
  };

  const seedReservation = async (
    checkIn: string,
    overrides: Partial<Reservation> = {},
  ) => {
    const telegramUserId = `tg-arrival-${next()}`;
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn: localDay(checkIn),
      checkOut: localDay(checkIn, 2),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana María Pérez',
      guestDni: '30111222',
      ...overrides,
    });
    em.persist(reservation);
    await em.flush();
    clientIds.push(telegramUserId);
    reservationIds.push(reservation.id);
    return reservation;
  };

  const messagesTo = (telegramUserId: string | undefined) =>
    sendMessage.mock.calls.filter(([chatId]) => chatId === telegramUserId);

  const arrivalMessageOf = (reservationId: string, type: ArrivalMessageType) =>
    em.fork().findOne(ArrivalMessage, { reservation: reservationId, type });

  const stubServices = (
    settings: Partial<RestaurantSettingsModel> | null,
    spaServices: Partial<SpaServiceModel>[],
  ) => {
    jest.spyOn(app.get(SpaService), 'listActive').mockResolvedValue(
      spaServices.map(
        (spa) =>
          ({
            availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
            ...spa,
          }) as SpaServiceModel,
      ),
    );
    const model = RestaurantSettingsModel.createDefault();
    model.applyChanges(settings ?? {});
    jest
      .spyOn(app.get(RestaurantService), 'getSettings')
      .mockResolvedValue({ settings: model, configured: settings !== null });
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
        createSpaPreference: jest.fn(),
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
    service = app.get(ArrivalMessageService);
    repository = app.get(ArrivalMessageRepository);

    const category = em.create(RoomCategory, {
      name: `Cat arrival ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `ARRIVAL-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  beforeEach(() => {
    // El service usa el EntityManager global: sin esto podría devolver filas cacheadas de otro test.
    orm.em.clear();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    stubServices(null, []);
    jest
      .spyOn(app.get(SupportHoursService), 'getDaySchedule')
      .mockResolvedValue({
        weekday: 1,
        isClosed: false,
        opensAt: '09:00',
        closesAt: '21:00',
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(ChatMessage, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(ChatSession, {
        telegramUserId: { $in: clientIds },
      });
      // Los mensajes se borran en cascada con la reserva.
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('recordatorio (CA1)', () => {
    it('sale 24 hs antes del check-in con la fecha, el horario y cómo llegar', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      const now = hotelTime(checkIn, 13, 1);

      await service.sendDueMessages(now);

      const [call] = messagesTo(reservation.telegramUserId);
      const text = String(call[1]);
      expect(text).toMatch(/^¡Hola Ana!/);
      expect(text).toContain(checkIn.split('-').reverse().join('-'));
      expect(text).toContain('a partir de las 13:00');
      expect(text).toContain('Cómo llegar:');
      expect(
        await arrivalMessageOf(reservation.id, ArrivalMessageType.REMINDER),
      ).toMatchObject({
        status: ArrivalMessageStatus.SENT,
        sentAt: now,
        telegramUserId: reservation.telegramUserId,
      });
    });

    it('no sale antes de las 24 hs', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 12, 1));
      await service.sendDueMessages(hotelTime(checkIn, 13, 2));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(0);
    });

    it('se manda una sola vez por reserva', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));
      await service.sendDueMessages(hotelTime(checkIn, 14, 1));
      await service.sendDueMessages(hotelTime(checkIn, 22, 1));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(1);
    });

    it('si dos corridas se pisan, solo una toma el mensaje', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      const now = hotelTime(checkIn, 13, 1);

      await Promise.all([
        service.sendDueMessages(now),
        service.sendDueMessages(now),
      ]);

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(1);
    });

    it('una reserva confirmada después de esa hora igual lo recibe', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 20, 1));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(1);
    });

    it('queda en el chat como mensaje de Chamber', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      const [message] = await em.fork().find(ChatMessage, {
        telegramUserId: reservation.telegramUserId,
      });
      expect(message.role).toBe(MessageRole.BOT);
      expect(message.content).toBe(
        messagesTo(reservation.telegramUserId)[0][1],
      );
    });
  });

  describe('bienvenida (CA2)', () => {
    it('sale el día del check-in con la información para el ingreso', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      const now = hotelTime(checkIn, 9);

      await service.sendDueMessages(now);

      const [call] = messagesTo(reservation.telegramUserId);
      const text = String(call[1]);
      expect(text).toContain('bienvenida');
      expect(text).toContain('Check-in: a partir de las 13:00');
      expect(text).toContain('Recepción: hoy de 09:00 a 21:00');
      expect(
        await arrivalMessageOf(reservation.id, ArrivalMessageType.WELCOME),
      ).toMatchObject({ status: ArrivalMessageStatus.SENT, sentAt: now });
    });

    it('no sale de madrugada', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 8));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(0);
    });

    it('el día de la llegada no manda el recordatorio atrasado', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 10));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(1);
      expect(
        await arrivalMessageOf(reservation.id, ArrivalMessageType.REMINDER),
      ).toBeNull();
    });

    it('recibe el recordatorio y después la bienvenida, una vez cada uno', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));
      await service.sendDueMessages(hotelTime(checkIn, 9));
      await service.sendDueMessages(hotelTime(checkIn, 10));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(2);
    });

    it('ofrece el spa y el restó si están disponibles hoy', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      stubServices(
        {
          status: RestaurantStatus.ACTIVE,
          shifts: [{ opensAt: '20:00', closesAt: '23:00' }],
          roomServiceEnabled: true,
        },
        [{ name: 'Masajes' }],
      );

      await service.sendDueMessages(hotelTime(checkIn, 9));

      const text = String(messagesTo(reservation.telegramUserId)[0][1]);
      expect(text).toContain('Spa, sin cargo para huéspedes: Masajes');
      expect(text).toContain('Restó: todos los días de 20:00 a 23:00');
      expect(text).toContain('Room service: de 07:00 a 23:00');
    });

    it('no ofrece el restó inactivo ni lo que no abre ese día', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      const now = hotelTime(checkIn, 9);
      const otherDay = (now.getUTCDay() + 1) % 7;
      stubServices({ status: RestaurantStatus.INACTIVE }, [
        { name: 'Masajes', availableWeekdays: [otherDay] },
      ]);

      await service.sendDueMessages(now);

      const text = String(messagesTo(reservation.telegramUserId)[0][1]);
      expect(text).not.toContain('Spa');
      expect(text).not.toContain('Restó');
    });

    it('un restó activo que hoy no abre tampoco se ofrece', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      const now = hotelTime(checkIn, 9);
      stubServices(
        {
          status: RestaurantStatus.ACTIVE,
          availableWeekdays: [(now.getUTCDay() + 1) % 7],
        },
        [],
      );

      await service.sendDueMessages(now);

      expect(
        String(messagesTo(reservation.telegramUserId)[0][1]),
      ).not.toContain('Restó');
    });
  });

  describe('solo reservas confirmadas (CA3)', () => {
    it.each([
      ['pendiente de pago', ReservationStatus.PENDING_PAYMENT],
      ['cancelada', ReservationStatus.CANCELLED],
    ])('no le escribe a una reserva %s', async (_, status) => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn, { status });

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));
      await service.sendDueMessages(hotelTime(checkIn, 9));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(0);
      expect(
        await em.fork().count(ArrivalMessage, { reservation: reservation.id }),
      ).toBe(0);
    });

    it('si se cancela después del recordatorio, ya no recibe la bienvenida', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));
      await em
        .fork()
        .nativeUpdate(
          Reservation,
          { id: reservation.id },
          { status: ReservationStatus.CANCELLED },
        );
      await service.sendDueMessages(hotelTime(checkIn, 9));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(1);
    });

    it('si se cancela durante la corrida, no se manda', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      const realClaim = repository.claim.bind(repository);
      jest
        .spyOn(repository, 'claim')
        .mockImplementation(async (reservationId, type) => {
          await em
            .fork()
            .nativeUpdate(
              Reservation,
              { id: reservationId },
              { status: ReservationStatus.CANCELLED },
            );
          return realClaim(reservationId, type);
        });

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(0);
    });

    it('deja afuera las reservas cargadas a mano sin Telegram', async () => {
      const checkIn = nextCheckInDay();
      const manual = await seedReservation(checkIn, {
        telegramUserId: undefined,
        origin: ReservationOrigin.MANUAL,
      });

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      expect(sendMessage).not.toHaveBeenCalled();
      expect(
        await em.fork().count(ArrivalMessage, { reservation: manual.id }),
      ).toBe(0);
    });
  });

  describe('fallos de envío (CA4)', () => {
    const blockedByUser = () =>
      Object.assign(new Error('Forbidden: bot was blocked by the user'), {
        code: 403,
      });

    it('registra el bloqueo y sigue con el resto de los huéspedes', async () => {
      const checkIn = nextCheckInDay();
      const first = await seedReservation(checkIn);
      const second = await seedReservation(checkIn);
      const third = await seedReservation(checkIn);
      sendMessage.mockImplementationOnce(() => Promise.reject(blockedByUser()));

      const sent = await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      expect(sent).toBe(2);
      expect(sendMessage).toHaveBeenCalledTimes(3);

      const rows = await em.fork().find(ArrivalMessage, {
        reservation: { $in: [first.id, second.id, third.id] },
      });
      expect(rows.map(({ status }) => status as string).sort()).toEqual([
        ArrivalMessageStatus.BLOCKED,
        ArrivalMessageStatus.SENT,
        ArrivalMessageStatus.SENT,
      ]);
      const blocked = rows.find(({ failureReason }) => failureReason);
      expect(blocked?.failureReason).toContain('blocked by the user');
      expect(blocked?.sentAt).toBeNull();
    });

    it('registra cualquier otro error como fallido', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      sendMessage.mockRejectedValueOnce(new Error('socket hang up'));

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      expect(
        await arrivalMessageOf(reservation.id, ArrivalMessageType.REMINDER),
      ).toMatchObject({
        status: ArrivalMessageStatus.FAILED,
        failureReason: 'Error: socket hang up',
      });
    });

    it('no toca la reserva, no reintenta y la bienvenida se intenta igual', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      sendMessage.mockImplementationOnce(() => Promise.reject(blockedByUser()));

      await service.sendDueMessages(hotelTime(checkIn, 13, 1));
      await service.sendDueMessages(hotelTime(checkIn, 14, 1));

      expect(messagesTo(reservation.telegramUserId)).toHaveLength(1);
      const stored = await em.fork().findOneOrFail(Reservation, reservation.id);
      expect(stored.status).toBe(ReservationStatus.CONFIRMED);

      await service.sendDueMessages(hotelTime(checkIn, 9));
      expect(messagesTo(reservation.telegramUserId)).toHaveLength(2);
    });

    it('un error de base con una reserva no frena a las demás', async () => {
      const checkIn = nextCheckInDay();
      const first = await seedReservation(checkIn);
      const second = await seedReservation(checkIn);
      const realClaim = repository.claim.bind(repository);
      jest
        .spyOn(repository, 'claim')
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockImplementation(realClaim);

      const sent = await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      expect(sent).toBe(1);
      expect(
        messagesTo(first.telegramUserId).length +
          messagesTo(second.telegramUserId).length,
      ).toBe(1);
    });

    it('si falla el registro en el chat, el mensaje igual cuenta como enviado', async () => {
      const checkIn = nextCheckInDay();
      const reservation = await seedReservation(checkIn);
      jest
        .spyOn(app.get(ChatService), 'getOrCreateSession')
        .mockRejectedValueOnce(new Error('boom'));

      const sent = await service.sendDueMessages(hotelTime(checkIn, 13, 1));

      expect(sent).toBe(1);
      expect(
        await arrivalMessageOf(reservation.id, ArrivalMessageType.REMINDER),
      ).toMatchObject({ status: ArrivalMessageStatus.SENT });
    });

    it('el cron no propaga un error general', async () => {
      jest
        .spyOn(service, 'sendDueMessages')
        .mockRejectedValueOnce(new Error('base caída'));

      await expect(service.handleMessagesCron()).resolves.toBeUndefined();
    });
  });
});
