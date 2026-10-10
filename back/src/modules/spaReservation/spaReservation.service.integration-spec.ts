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
  SpaReservationClientType,
  SpaReservationStatus,
} from '../../infrastructure/database/entities/SpaReservation.entity';

/**
 * Integración de SpaReservationService contra la base de test: reservas, servicios y turnos son
 * filas reales; Mercado Pago y Telegram están simulados. Las reglas puras (disponibilidad horaria
 * del servicio, matemática de la capacidad) tienen su test de modelo; acá se prueba el flujo
 * completo y lo que queda persistido.
 *
 * Estadía del huésped: 10 al 20 de marzo de 2099. "Hoy" lo fija cada test con `now`.
 */
describe('SpaReservationService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: SpaReservationService;

  const sendMessage = jest.fn();
  const createSpaPreference = jest.fn();
  const getPayment = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  // 15/03/2099 12:00 en Buenos Aires: dentro de la estadía.
  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
  const GUEST_NAME = 'Ana E2E';
  const EXTERNAL = { fullName: 'Beto Externo', dni: '28111222' };
  const INIT_POINT = 'https://mp.example/pagar-turno';

  let categoryId: string;
  let roomId: string;
  const clientIds: string[] = [];
  const reservationIds: string[] = [];
  const spaServiceIds: string[] = [];

  /** Un huésped: tiene una reserva confirmada del 10 al 20 de marzo de 2099. */
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
    clientIds.push(telegramUserId);
    reservationIds.push(reservation.id);
    return { telegramUserId, reservationId: reservation.id };
  };

  /** Un cliente externo: no tiene ninguna reserva de habitación. */
  const newExternal = () => {
    const telegramUserId = `tg-spa-ext-${next()}`;
    clientIds.push(telegramUserId);
    return telegramUserId;
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

  const rowById = (id: string) =>
    em.fork().findOneOrFail(SpaReservation, { id });

  /** Envejece un turno para simular que pasó el tiempo de retención del pago. */
  const age = (id: string, minutes: number) =>
    em.nativeUpdate(
      SpaReservation,
      { id },
      { createdAt: new Date(Date.now() - minutes * 60 * 1000) },
    );

  const request = (
    telegramUserId: string,
    serviceId: string,
    date: string,
    time = '15:00',
    now = NOW,
    extra: { fullName?: string; dni?: string } = {},
  ) =>
    service.requestSpa(
      telegramUserId,
      { serviceId, date, time, ...extra },
      now,
    );

  const requestAsExternal = (
    telegramUserId: string,
    serviceId: string,
    date: string,
    time = '15:00',
  ) => request(telegramUserId, serviceId, date, time, NOW, EXTERNAL);

  /** Crea un turno de un externo y devuelve su id (falla el test si no se pudo crear). */
  const createExternalTurn = async (
    spa: SpaService,
    date = '16-03-2099',
    time = '15:00',
  ) => {
    const telegramUserId = newExternal();
    const result = await requestAsExternal(telegramUserId, spa.id, date, time);
    if (!result.ok)
      throw new Error(`No se pudo crear el turno: ${result.reason}`);
    return { id: result.request.id, telegramUserId };
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
        createSpaPreference,
        getPayment,
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
    createSpaPreference.mockReset();
    createSpaPreference.mockResolvedValue({
      preferenceId: 'pref-1',
      initPoint: INIT_POINT,
    });
    getPayment.mockReset();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(ChatMessage, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(ChatSession, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(SpaReservation, {
        telegramUserId: { $in: clientIds },
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

  describe('turno de un huésped (CA4)', () => {
    it('registra el turno PENDING, sin cobro, con los datos del huésped y del servicio', async () => {
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
        clientType: SpaReservationClientType.GUEST,
        serviceName: spa.name,
        guestFullName: GUEST_NAME,
        requestedDate: '2099-03-16',
        requestedTime: '15:00',
      });
      expect(Number(row.amount)).toBe(0);
      expect(row.roomReservation?.id).toBe(guest.reservationId);
      expect(createSpaPreference).not.toHaveBeenCalled();
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

    it('rechaza un horario de hoy que ya pasó', async () => {
      const guest = await seedGuest();
      const spa = await seedSpa();

      // son las 12:00 del 15/03: las 11:00 de hoy ya pasaron, las 15:00 no
      const past = await request(
        guest.telegramUserId,
        spa.id,
        '15-03-2099',
        '11:00',
      );
      const future = await request(
        guest.telegramUserId,
        spa.id,
        '15-03-2099',
        '15:00',
      );

      expect(past).toEqual({ ok: false, reason: 'Ese horario ya pasó.' });
      expect(future.ok).toBe(true);
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

  describe('turno de un cliente externo (cobro)', () => {
    it('le pide nombre y DNI si faltan y no guarda nada', async () => {
      const spa = await seedSpa();
      const external = newExternal();

      const withoutData = await request(external, spa.id, '16-03-2099');
      const withoutDni = await request(
        external,
        spa.id,
        '16-03-2099',
        '15:00',
        NOW,
        { fullName: 'Beto Externo' },
      );

      expect(withoutData.ok).toBe(false);
      expect(!withoutData.ok && withoutData.reason).toMatch(
        /nombre completo y tu DNI/,
      );
      expect(withoutDni.ok).toBe(false);
      expect(await rowsOf(external)).toHaveLength(0);
      expect(createSpaPreference).not.toHaveBeenCalled();
    });

    it('guarda el turno PENDING_PAYMENT con el monto y responde con el link de pago', async () => {
      const spa = await seedSpa({ price: 23000 });
      const external = newExternal();

      const result = await requestAsExternal(external, spa.id, '16-03-2099');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.reply).toContain('Total: $23000');
      expect(result.reply).toContain('Todavía no está confirmado');
      expect(result.reply).toContain('30 minutos');
      expect(result.reply).toContain(INIT_POINT);
      expect(result.reply).toContain('Beto Externo');

      expect(createSpaPreference).toHaveBeenCalledWith({
        id: result.request.id,
        serviceName: spa.name,
        amount: 23000,
        fullName: 'Beto Externo',
        dni: '28111222',
      });
      const row = await rowById(result.request.id);
      expect(row).toMatchObject({
        status: SpaReservationStatus.PENDING_PAYMENT,
        clientType: SpaReservationClientType.EXTERNAL,
        guestFullName: 'Beto Externo',
        guestDni: '28111222',
        mpPreferenceId: 'pref-1',
        mpInitPoint: INIT_POINT,
      });
      expect(Number(row.amount)).toBe(23000);
      expect(row.roomReservation).toBeNull();
    });

    it('lo deja reservar sin estadía, hasta 60 días hacia adelante', async () => {
      const spa = await seedSpa();

      // 15/03/2099 + 60 días = 14/05/2099
      const lastDay = await requestAsExternal(
        newExternal(),
        spa.id,
        '14-05-2099',
      );
      const tooFar = await requestAsExternal(
        newExternal(),
        spa.id,
        '15-05-2099',
      );

      expect(lastDay.ok).toBe(true);
      expect(tooFar.ok).toBe(false);
      expect(!tooFar.ok && tooFar.reason).toMatch(/hasta 60 días/);
    });

    it('si no se puede generar el link de pago, cancela el turno y libera el lugar', async () => {
      const spa = await seedSpa();
      const external = newExternal();
      createSpaPreference.mockRejectedValueOnce(
        new Error('Mercado Pago caído'),
      );

      const result = await requestAsExternal(external, spa.id, '16-03-2099');

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toMatch(/link de pago/);
      const [row] = await rowsOf(external);
      expect(row.status).toBe(SpaReservationStatus.CANCELLED);
    });
  });

  describe('capacidad', () => {
    it('no vende más turnos que la capacidad, sea de huésped o de externo', async () => {
      const spa = await seedSpa({ capacity: 1 });
      const guest = await seedGuest();

      const first = await request(guest.telegramUserId, spa.id, '16-03-2099');
      const sameTime = await requestAsExternal(
        newExternal(),
        spa.id,
        '16-03-2099',
      );
      const overlapping = await requestAsExternal(
        newExternal(),
        spa.id,
        '16-03-2099',
        '15:30',
      );
      const rightAfter = await requestAsExternal(
        newExternal(),
        spa.id,
        '16-03-2099',
        '16:00',
      );

      expect(first.ok).toBe(true);
      expect(sameTime.ok).toBe(false);
      expect(!sameTime.ok && sameTime.reason).toMatch(/Ya no quedan lugares/);
      expect(overlapping.ok).toBe(false);
      expect(rightAfter.ok).toBe(true);
    });

    it('con capacidad 2 caben dos turnos a la vez y el tercero no', async () => {
      const spa = await seedSpa({ capacity: 2 });

      const results: Awaited<ReturnType<typeof requestAsExternal>>[] = [];
      for (let i = 0; i < 3; i++) {
        results.push(
          await requestAsExternal(newExternal(), spa.id, '16-03-2099'),
        );
      }

      expect(results.map((result) => result.ok)).toEqual([true, true, false]);
    });

    it('dos pedidos simultáneos por el último lugar: solo uno lo consigue', async () => {
      const spa = await seedSpa({ capacity: 1 });
      const [a, b] = [await seedGuest(), await seedGuest()];

      const results = await Promise.all([
        request(a.telegramUserId, spa.id, '16-03-2099'),
        request(b.telegramUserId, spa.id, '16-03-2099'),
      ]);

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      const rows = [
        ...(await rowsOf(a.telegramUserId)),
        ...(await rowsOf(b.telegramUserId)),
      ];
      expect(rows).toHaveLength(1);
    });
  });

  describe('pago del cliente externo', () => {
    const approve = (paymentId: string, reference: string) =>
      getPayment.mockResolvedValue({
        id: Number(paymentId),
        status: 'approved',
        external_reference: reference,
      });

    it('un pago aprobado confirma el turno, guarda el pago y avisa una sola vez', async () => {
      const spa = await seedSpa();
      const turn = await createExternalTurn(spa);
      approve('777', turn.id);

      await service.confirmPayment('777', 'webhook');
      // el redirect de Mercado Pago suele llegar casi junto con el webhook
      await service.confirmPayment('777', 'back_url');

      const row = await rowById(turn.id);
      expect(row.status).toBe(SpaReservationStatus.CONFIRMED);
      expect(row.mpPaymentId).toBe('777');
      expect(sendMessage).toHaveBeenCalledTimes(1);
      const [to, notice] = sendMessage.mock.calls[0] as [string, string];
      expect(to).toBe(turn.telegramUserId);
      expect(notice).toContain('Recibimos tu pago');
      expect(notice).toContain(`${spa.name} del 16/03/2099 a las 15:00`);
    });

    it('un pago que no está aprobado no confirma nada', async () => {
      const turn = await createExternalTurn(await seedSpa());
      getPayment.mockResolvedValue({
        id: 778,
        status: 'pending',
        external_reference: turn.id,
      });

      await service.confirmPayment('778', 'webhook');

      expect((await rowById(turn.id)).status).toBe(
        SpaReservationStatus.PENDING_PAYMENT,
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('un pago que llega con el turno ya vencido no lo revive ni avisa', async () => {
      const turn = await createExternalTurn(await seedSpa());
      await age(turn.id, 60);
      await service.releaseUnpaid();
      approve('779', turn.id);

      await service.confirmPayment('779', 'webhook');

      expect((await rowById(turn.id)).status).toBe(
        SpaReservationStatus.CANCELLED,
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('ignora un pago de un turno que no existe', async () => {
      approve('780', '00000000-0000-0000-0000-000000000000');

      await expect(
        service.confirmPayment('780', 'webhook'),
      ).resolves.toBeUndefined();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('vencimiento del pago', () => {
    it('cancela solo los turnos de externos sin pagar hace más de 30 minutos', async () => {
      const spa = await seedSpa({ capacity: 5 });
      const old = await createExternalTurn(spa, '16-03-2099', '10:00');
      const recent = await createExternalTurn(spa, '16-03-2099', '12:00');
      const guest = await seedGuest();
      const guestTurn = await request(
        guest.telegramUserId,
        spa.id,
        '16-03-2099',
        '14:00',
      );
      if (!guestTurn.ok) throw new Error('El turno del huésped no se creó');
      await age(old.id, 60);
      await age(guestTurn.request.id, 60);

      await service.releaseUnpaid();

      expect((await rowById(old.id)).status).toBe(
        SpaReservationStatus.CANCELLED,
      );
      expect((await rowById(recent.id)).status).toBe(
        SpaReservationStatus.PENDING_PAYMENT,
      );
      // el turno de un huésped espera a recepción, no al pago: no vence
      expect((await rowById(guestTurn.request.id)).status).toBe(
        SpaReservationStatus.PENDING,
      );
    });

    it('el lugar de un turno vencido vuelve a estar disponible', async () => {
      const spa = await seedSpa({ capacity: 1 });
      const held = await createExternalTurn(spa);
      const blocked = await requestAsExternal(
        newExternal(),
        spa.id,
        '16-03-2099',
      );
      await age(held.id, 60);

      await service.releaseUnpaid();
      const afterRelease = await requestAsExternal(
        newExternal(),
        spa.id,
        '16-03-2099',
      );

      expect(blocked.ok).toBe(false);
      expect(afterRelease.ok).toBe(true);
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

    const statusInDb = async (id: string) => (await rowById(id)).status;

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

    it('no deja resolver a mano un turno que espera el pago del cliente', async () => {
      const turn = await createExternalTurn(await seedSpa());

      await expect(
        service.changeStatus(turn.id, SpaReservationStatus.CONFIRMED),
      ).rejects.toThrow(/esperando el pago/);

      expect(await statusInDb(turn.id)).toBe(
        SpaReservationStatus.PENDING_PAYMENT,
      );
      expect(sendMessage).not.toHaveBeenCalled();
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
