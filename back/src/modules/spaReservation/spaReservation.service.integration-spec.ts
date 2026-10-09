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
import { SpaReservationService } from './spaReservation.service';
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
  SpaService,
  SpaServiceStatus,
} from '../../infrastructure/database/entities/SpaService.entity';
import {
  ChatMessage,
  MessageRole,
} from '../../infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';
import {
  SpaReservation,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';

/**
 * Integración de SpaReservationService contra la base de test: reservas, servicios y turnos son
 * filas reales. Las reglas puras (disponibilidad horaria del servicio, elegibilidad) tienen su
 * test de modelo; acá se prueba el flujo completo y lo que queda persistido.
 *
 * Estadía del huésped: 10 al 20 de marzo de 2099. "Hoy" lo fija cada test con `now`.
 */
describe('SpaReservationService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: SpaReservationService;

  const sendMessage = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  // 15/03/2099 12:00 en Buenos Aires: dentro de la estadía.
  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
  const GUEST_NAME = 'Ana E2E';

  let categoryId: string;
  let roomId: string;
  const guestIds: string[] = [];
  const reservationIds: string[] = [];
  const spaServiceIds: string[] = [];

  const seedGuest = async (status = ReservationStatus.CONFIRMED) => {
    const telegramUserId = `tg-spa-res-${next()}`;
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      // mediodía local: el día calendario no se corre con ninguna zona horaria
      checkIn: new Date(2099, 2, 10, 12),
      checkOut: new Date(2099, 2, 20, 12),
      status,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: GUEST_NAME,
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    guestIds.push(telegramUserId);
    reservationIds.push(reservation.id);
    return { telegramUserId, reservationId: reservation.id };
  };

  const seedSpa = async (overrides: Partial<SpaService> = {}) => {
    const spa = em.create(SpaService, {
      name: `Masaje <relax> ${next()}`,
      description: 'Masaje de 60 minutos',
      durationMinutes: 60,
      price: 15000,
      availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
      opensAt: '10:00',
      closesAt: '20:00',
      ...overrides,
    });
    em.persist(spa);
    await em.flush();
    spaServiceIds.push(spa.id);
    return spa;
  };

  const rowsOf = (telegramUserId: string) =>
    em.fork().find(SpaReservation, { telegramUserId });

  const request = (
    telegramUserId: string,
    serviceId: string,
    date: string,
    time = '15:00',
    now = NOW,
  ) => service.requestSpa(telegramUserId, { serviceId, date, time }, now);

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
        telegram: { sendMessage },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(SpaReservationService);

    const category = em.create(RoomCategory, {
      name: `Cat spa-reservation ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `SPA-${suffix}`,
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
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(ChatMessage, { telegramUserId: { $in: guestIds } });
      await em.nativeDelete(ChatSession, { telegramUserId: { $in: guestIds } });
      await em.nativeDelete(SpaReservation, {
        telegramUserId: { $in: guestIds },
      });
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(SpaService, { id: { $in: spaServiceIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('requestSpa (CA4)', () => {
    it('registra el turno PENDING con los datos del huésped y del servicio', async () => {
      const guest = await seedGuest();
      const spa = await seedSpa();

      const result = await request(guest.telegramUserId, spa.id, '16-03-2099');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // el nombre del servicio viene escapado para el HTML de Telegram
      expect(result.reply).toBe(
        `Listo, registré tu solicitud de ${spa.name.replace('<', '&lt;').replace('>', '&gt;')} para el 16-03-2099 a las 15:00. Recepción te va a confirmar el turno.`,
      );

      const [row] = await rowsOf(guest.telegramUserId);
      expect(row).toMatchObject({
        id: result.request.id,
        status: SpaReservationStatus.PENDING,
        serviceName: spa.name,
        guestFullName: GUEST_NAME,
        requestedDate: '2099-03-16',
        requestedTime: '15:00',
      });
    });

    it('acepta el día de hoy y el último día de la estadía', async () => {
      const guest = await seedGuest();
      const spa = await seedSpa();

      const today = await request(guest.telegramUserId, spa.id, '15-03-2099');
      const lastDay = await request(guest.telegramUserId, spa.id, '20-03-2099');

      expect(today.ok).toBe(true);
      expect(lastDay.ok).toBe(true);
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(2);
    });

    it('rechaza a un huésped sin reserva confirmada (CA2) y no guarda nada', async () => {
      const guest = await seedGuest(ReservationStatus.PENDING_PAYMENT);
      const spa = await seedSpa();

      const result = await request(guest.telegramUserId, spa.id, '16-03-2099');

      expect(result).toEqual({
        ok: false,
        reason:
          'Los turnos de spa son para huéspedes con una reserva confirmada.',
      });
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });

    it('rechaza un servicio deshabilitado (CA7) y no guarda nada', async () => {
      const guest = await seedGuest();
      const spa = await seedSpa({ status: SpaServiceStatus.INACTIVE });

      const result = await request(guest.telegramUserId, spa.id, '16-03-2099');

      expect(result).toEqual({
        ok: false,
        reason: 'Ese servicio de spa ya no está disponible.',
      });
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });

    it.each([
      ['una fecha pasada', '14-03-2099', NOW, /ya pasó/],
      [
        'una fecha posterior a la salida',
        '21-03-2099',
        NOW,
        /durante tu estadía/,
      ],
      [
        'una fecha anterior a la entrada',
        '05-03-2099',
        new Date(Date.UTC(2099, 2, 1, 15, 0)),
        /durante tu estadía/,
      ],
    ])('rechaza %s', async (_label, date, now, reason) => {
      const guest = await seedGuest();
      const spa = await seedSpa();

      const result = await request(
        guest.telegramUserId,
        spa.id,
        date,
        '15:00',
        now,
      );

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toMatch(reason);
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });

    it('rechaza un día en que el servicio no se brinda, indicando cuándo sí', async () => {
      const guest = await seedGuest();
      // lunes a viernes; el 15/03/2099 es domingo
      const spa = await seedSpa({ availableWeekdays: [1, 2, 3, 4, 5] });

      const result = await request(guest.telegramUserId, spa.id, '15-03-2099');

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toMatch(
        /lunes, martes, miércoles, jueves, viernes de 10:00 a 20:00/,
      );
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });

    it('no duplica un turno pendiente idéntico', async () => {
      const guest = await seedGuest();
      const spa = await seedSpa();

      await request(guest.telegramUserId, spa.id, '16-03-2099');
      const repeated = await request(
        guest.telegramUserId,
        spa.id,
        '16-03-2099',
      );

      expect(repeated.ok).toBe(false);
      expect(!repeated.ok && repeated.reason).toMatch(/Ya tengo registrada/);
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(1);
    });
  });

  describe('changeStatus', () => {
    const createPending = async () => {
      const guest = await seedGuest();
      const spa = await seedSpa();
      const result = await request(guest.telegramUserId, spa.id, '16-03-2099');
      if (!result.ok) throw new Error('El turno de prueba no se pudo crear');
      return {
        id: result.request.id,
        telegramUserId: guest.telegramUserId,
        serviceName: spa.name,
      };
    };

    const statusInDb = async (id: string) =>
      (await em.fork().findOneOrFail(SpaReservation, { id })).status;

    it.each([
      [SpaReservationStatus.CONFIRMED, 'quedó confirmado'],
      [SpaReservationStatus.REJECTED, 'No pudimos confirmar'],
    ])(
      'resuelve un turno pendiente como %s, lo persiste y avisa al huésped',
      async (status, text) => {
        const { id, telegramUserId, serviceName } = await createPending();

        const result = await service.changeStatus(id, status);

        expect(result.status).toBe(status);
        expect(await statusInDb(id)).toBe(status);
        expect(sendMessage).toHaveBeenCalledTimes(1);
        const [to, notice] = sendMessage.mock.calls[0] as [string, string];
        expect(to).toBe(telegramUserId);
        expect(notice).toContain(`${serviceName} del 16/03/2099 a las 15:00`);
        expect(notice).toContain(text);
      },
    );

    it('deja el aviso registrado en el chat del huésped', async () => {
      const { id, telegramUserId } = await createPending();

      await service.changeStatus(id, SpaReservationStatus.CONFIRMED);

      const messages = await em.fork().find(ChatMessage, { telegramUserId });
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe(MessageRole.SYSTEM);
      expect(messages[0].content).toBe(sendMessage.mock.calls[0][1]);
    });

    it('resuelve el turno aunque Telegram falle, y no registra un aviso que no se mandó', async () => {
      sendMessage.mockRejectedValueOnce(
        new Error('bot bloqueado por el usuario'),
      );
      const { id, telegramUserId } = await createPending();

      await expect(
        service.changeStatus(id, SpaReservationStatus.CONFIRMED),
      ).resolves.toMatchObject({ status: SpaReservationStatus.CONFIRMED });

      expect(await statusInDb(id)).toBe(SpaReservationStatus.CONFIRMED);
      expect(await em.fork().count(ChatMessage, { telegramUserId })).toBe(0);
    });

    it('no deja cambiar un turno ya resuelto ni volverlo a PENDING, y no vuelve a avisar', async () => {
      const { id } = await createPending();
      await service.changeStatus(id, SpaReservationStatus.CONFIRMED);

      await expect(
        service.changeStatus(id, SpaReservationStatus.REJECTED),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.changeStatus(id, SpaReservationStatus.PENDING),
      ).rejects.toThrow(BadRequestException);
      expect(await statusInDb(id)).toBe(SpaReservationStatus.CONFIRMED);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('lanza NotFound si el turno no existe', async () => {
      await expect(
        service.changeStatus(
          '00000000-0000-0000-0000-000000000000',
          SpaReservationStatus.CONFIRMED,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
