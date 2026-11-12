import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { CampaignService } from './campaign.service';
import { RecipientFilter } from './campaign.model';
import { AuthUser } from '../auth/auth.types';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { addDays, keyToUtc, zonedDateKey } from '../../common/date.util';
import {
  Campaign,
  CampaignAudience,
  CampaignStatus,
  CampaignStayFilter,
} from '../../infrastructure/database/entities/Campaign.entity';
import {
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
import {
  BookingProcess,
  BookingProcessStep,
} from '../../infrastructure/database/entities/BookingProcess.entity';
import {
  User,
  UserRole,
} from '../../infrastructure/database/entities/User.entity';

describe('CampaignService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: CampaignService;
  const sendMessage = jest.fn();
  const sendPhoto = jest.fn();

  const suffix = Date.now();
  const PREFIX = `tg-campaign-${suffix}`;
  let categoryId: string;
  let roomId: string;
  let admin: AuthUser;

  /** Tres contactos: uno con reserva confirmada, uno con reservas que no cuentan y uno sin reservas. */
  const guests = {
    confirmed: `${PREFIX}-confirmed`,
    notConfirmed: `${PREFIX}-not-confirmed`,
    noReservation: `${PREFIX}-none`,
  };

  const count = async (filter: RecipientFilter) =>
    (await service.countRecipients(filter)).count;

  const counts = async () => ({
    all: await count({ audience: CampaignAudience.ALL }),
    confirmed: await count({ audience: CampaignAudience.CONFIRMED }),
    noReservation: await count({ audience: CampaignAudience.NO_RESERVATION }),
  });

  let before: Awaited<ReturnType<typeof counts>>;

  const seedReservation = (
    telegramUserId: string,
    status: ReservationStatus,
    offsetDays: number,
  ) =>
    em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn: new Date(2098, 2, 1 + offsetDays, 12),
      checkOut: new Date(2098, 2, 3 + offsetDays, 12),
      status,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Huésped Campaña',
      guestDni: '30111222',
    });

  const campaignRow = (id: string) =>
    em.fork().findOneOrFail(Campaign, { id }, { refresh: true });

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
        telegram: { sendMessage, sendPhoto },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(CampaignService);

    const user = em.create(User, {
      email: `campaign-${suffix}@omnidesk.test`,
      passwordHash: 'x',
      fullName: 'Admin Campañas',
      role: UserRole.ADMIN,
    });
    const category = em.create(RoomCategory, {
      name: `Cat campaign ${suffix}`,
      capacity: 2,
      basePrice: 50000,
    });
    const room = em.create(Room, {
      roomNumber: `CAMPAIGN-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([user, category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
    admin = { id: user.id, email: user.email, role: UserRole.ADMIN };

    before = await counts();

    em.persist([
      ...Object.values(guests).map((telegramUserId) =>
        em.create(ChatSession, {
          telegramUserId,
          lastMessagePreview: 'Hola',
        }),
      ),
      seedReservation(guests.confirmed, ReservationStatus.CONFIRMED, 0),
      seedReservation(guests.confirmed, ReservationStatus.CANCELLED, 5),
      seedReservation(guests.notConfirmed, ReservationStatus.CANCELLED, 10),
      seedReservation(
        guests.notConfirmed,
        ReservationStatus.PENDING_PAYMENT,
        15,
      ),
    ]);
    await em.flush();
  });

  beforeEach(() => {
    orm.em.clear();
    sendMessage.mockReset().mockResolvedValue({});
    sendPhoto.mockReset();
  });

  afterAll(async () => {
    const steps = [
      () => service?.whenIdle(),
      () => em.nativeDelete(Campaign, { createdBy: admin?.id }),
      () => (roomId ? em.nativeDelete(Reservation, { room: roomId }) : 0),
      () => (roomId ? em.nativeDelete(Room, { id: roomId }) : 0),
      () =>
        categoryId ? em.nativeDelete(RoomCategory, { id: categoryId }) : 0,
      () =>
        em.nativeDelete(BookingProcess, {
          telegramUserId: { $like: `${PREFIX}%` },
        }),
      () =>
        em.nativeDelete(ChatMessage, {
          telegramUserId: { $like: `${PREFIX}%` },
        }),
      () =>
        em.nativeDelete(ChatSession, {
          telegramUserId: { $like: `${PREFIX}%` },
        }),
      () => (admin ? em.nativeDelete(User, { id: admin.id }) : 0),
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

  describe('destinatarios (CA2)', () => {
    it('"todos" son todas las conversaciones con Chamber', async () => {
      expect((await counts()).all).toBe(before.all + 3);
    });

    it('con reserva confirmada cuenta a quien tiene al menos una CONFIRMED, aunque tenga otras canceladas', async () => {
      expect((await counts()).confirmed).toBe(before.confirmed + 1);
    });

    it('sin reserva incluye a quien solo tiene pagos pendientes o reservas canceladas', async () => {
      expect((await counts()).noReservation).toBe(before.noReservation + 2);
    });

    it('confirmados y sin reserva se reparten a todos los contactos', async () => {
      const now = await counts();
      expect(now.confirmed + now.noReservation).toBe(now.all);
    });
  });

  describe('envío (CA4 y CA5)', () => {
    it('registra la campaña, la manda en segundo plano y cuenta enviados, fallidos y bloqueados', async () => {
      sendMessage.mockImplementation((chatId: string) =>
        chatId === guests.noReservation
          ? Promise.reject(
              Object.assign(new Error('bot was blocked by the user'), {
                code: 403,
              }),
            )
          : Promise.resolve({}),
      );
      const expected = (await counts()).noReservation;

      const created = await service.create(
        {
          title: 'Promo <invierno>',
          message: '20% off & desayuno',
          audience: CampaignAudience.NO_RESERVATION,
        },
        undefined,
        admin,
      );

      expect(created.status).toBe(CampaignStatus.SENDING);
      expect(created.totalRecipients).toBe(expected);
      expect(created.createdByName).toBe('Admin Campañas');

      await service.whenIdle();

      const row = await campaignRow(created.id);
      expect(row.status).toBe(CampaignStatus.COMPLETED);
      expect(row.finishedAt).toBeInstanceOf(Date);
      expect(row.sentCount + row.failedCount).toBe(expected);
      expect(row.failedCount).toBeGreaterThanOrEqual(1);
      expect(row.blockedCount).toBeGreaterThanOrEqual(1);

      const recipients = sendMessage.mock.calls.map(([chatId]) => chatId);
      expect(recipients).toEqual(
        expect.arrayContaining([guests.notConfirmed, guests.noReservation]),
      );
      expect(recipients).not.toContain(guests.confirmed);
      expect(sendMessage).toHaveBeenCalledWith(
        guests.notConfirmed,
        '<b>Promo &lt;invierno&gt;</b>\n\n20% off &amp; desayuno',
        { parse_mode: 'HTML' },
      );
    });

    it('deja la campaña en el chat de quien la recibió sin tocar la vista previa de la bandeja', async () => {
      const fork = em.fork();
      // El formato del aviso se prueba en campaign.model.spec.ts; acá solo que quedó guardado.
      const [received] = await fork.find(ChatMessage, {
        telegramUserId: guests.notConfirmed,
        role: MessageRole.SYSTEM,
      });
      expect(received.content).toContain('Promo <invierno>');

      expect(
        await fork.count(ChatMessage, { telegramUserId: guests.noReservation }),
      ).toBe(0);

      const session = await fork.findOneOrFail(ChatSession, {
        telegramUserId: guests.notConfirmed,
      });
      expect(session.lastMessagePreview).toBe('Hola');
    });

    it('con imagen sube la foto y la manda con el texto como pie', async () => {
      sendPhoto.mockResolvedValue({ photo: [{ file_id: 'file-campaign' }] });
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);

      const created = await service.create(
        {
          title: 'Spa',
          message: 'Masajes 2x1',
          audience: CampaignAudience.CONFIRMED,
        },
        jpeg,
        admin,
      );
      await service.whenIdle();

      expect(created.hasImage).toBe(true);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(sendPhoto).toHaveBeenCalledWith(
        expect.any(String),
        { source: jpeg, filename: 'campania.jpg' },
        { caption: '<b>Spa</b>\n\nMasajes 2x1', parse_mode: 'HTML' },
      );
      expect((await campaignRow(created.id)).status).toBe(
        CampaignStatus.COMPLETED,
      );
    });

    it('con imagen no deja pasar un texto más largo que el pie de foto', async () => {
      await expect(
        service.create(
          {
            title: 'x',
            message: 'a'.repeat(1100),
            audience: CampaignAudience.ALL,
          },
          Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
          admin,
        ),
      ).rejects.toThrow(/1024/);
    });

    it('no arranca una campaña mientras otra se está enviando', async () => {
      const running = em.create(Campaign, {
        title: 'En curso',
        message: 'x',
        audience: CampaignAudience.ALL,
        totalRecipients: 1,
        createdBy: em.getReference(User, admin.id),
      });
      await em.persist(running).flush();

      await expect(
        service.create(
          { title: 'Otra', message: 'y', audience: CampaignAudience.ALL },
          undefined,
          admin,
        ),
      ).rejects.toThrow(ConflictException);

      await em.nativeDelete(Campaign, { id: running.id });
    });

    it('al arrancar el servidor marca como interrumpidas las que quedaron a medio enviar', async () => {
      const stale = em.create(Campaign, {
        title: 'Cortada',
        message: 'x',
        audience: CampaignAudience.ALL,
        totalRecipients: 10,
        createdBy: em.getReference(User, admin.id),
      });
      await em.persist(stale).flush();

      await service.onApplicationBootstrap();

      const row = await campaignRow(stale.id);
      expect(row.status).toBe(CampaignStatus.INTERRUPTED);
      expect(row.finishedAt).toBeInstanceOf(Date);
    });
  });

  describe('historial (CA5)', () => {
    it('lista las campañas de la más nueva a la más vieja con quién la creó', async () => {
      const page = await service.list({ page: 1, pageSize: 100 });
      const mine = page.data.filter(
        (campaign) => campaign.createdByName === 'Admin Campañas',
      );

      expect(mine.map((campaign) => campaign.title)).toEqual([
        'Cortada',
        'Spa',
        'Promo <invierno>',
      ]);
      expect(page.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe('filtros por estadía', () => {
    const stay = {
      inHouse: `${PREFIX}-in-house`,
      upcoming: `${PREFIX}-upcoming`,
      finished: `${PREFIX}-finished`,
      unpaidPending: `${PREFIX}-unpaid-pending`,
      unpaidExpired: `${PREFIX}-unpaid-expired`,
      cancelledByGuest: `${PREFIX}-cancelled-by-guest`,
      /** Una estadía finalizada de 1 persona y un pedido sin pagar de 4. */
      mixed: `${PREFIX}-mixed`,
      /** Estadía finalizada sin guest_count: cuenta la capacidad de la habitación (2). */
      legacy: `${PREFIX}-legacy`,
      /** Consultó para 3 personas y nunca reservó. */
      quoted: `${PREFIX}-quoted`,
      /** Consultó para 1 persona, más adelante, y nunca reservó. */
      quotedSmall: `${PREFIX}-quoted-small`,
    };
    let today: string;

    const filters = {
      inHouse: {
        audience: CampaignAudience.ALL,
        stayFilter: CampaignStayFilter.IN_HOUSE,
      },
      upcoming: {
        audience: CampaignAudience.ALL,
        stayFilter: CampaignStayFilter.UPCOMING,
      },
      finished: {
        audience: CampaignAudience.ALL,
        stayFilter: CampaignStayFilter.FINISHED,
      },
      unpaid: {
        audience: CampaignAudience.ALL,
        stayFilter: CampaignStayFilter.UNPAID,
      },
      quoted: {
        audience: CampaignAudience.ALL,
        stayFilter: CampaignStayFilter.QUOTED,
      },
    } satisfies Record<string, RecipientFilter>;

    const range = (from: number, to: number) => ({
      stayFrom: addDays(today, from),
      stayTo: addDays(today, to),
    });

    // La base puede tener otros contactos: cada filtro se mide antes y después de sembrar los de acá.
    const measured = () => [
      ...Object.values(filters),
      { ...filters.upcoming, ...range(9, 11) },
      { ...filters.upcoming, ...range(20, 30) },
      { ...filters.finished, ...range(-8, -6) },
      { ...filters.finished, minGuests: 3 },
      { ...filters.finished, maxGuests: 2 },
      { ...filters.finished, minGuests: 2, maxGuests: 2 },
      { ...filters.unpaid, minGuests: 4 },
      { ...filters.unpaid, audience: CampaignAudience.NO_RESERVATION },
      { ...filters.inHouse, audience: CampaignAudience.NO_RESERVATION },
      { audience: CampaignAudience.ALL, minGuests: 4, maxGuests: 4 },
      { ...filters.quoted, minGuests: 2 },
      { ...filters.quoted, ...range(10, 20) },
      { ...filters.quoted, ...range(10, 20), maxGuests: 2 },
      { ...filters.quoted, audience: CampaignAudience.CONFIRMED },
    ];
    const baseline = new Map<string, number>();

    /** Cuántos contactos de este bloque suma el filtro. */
    const added = async (filter: RecipientFilter) => {
      const previous = baseline.get(JSON.stringify(filter));
      if (previous === undefined)
        throw new Error(`Falta medir ${JSON.stringify(filter)} antes`);
      return (await count(filter)) - previous;
    };

    const stayReservation = (
      telegramUserId: string,
      status: ReservationStatus,
      [checkInOffset, checkOutOffset]: [number, number],
      guestCount: number | null,
      extra: Partial<Pick<Reservation, 'cancelledAt' | 'mpPaymentId'>> = {},
    ) =>
      em.create(Reservation, {
        room: em.getReference(Room, roomId),
        telegramUserId,
        checkIn: keyToUtc(addDays(today, checkInOffset)),
        checkOut: keyToUtc(addDays(today, checkOutOffset)),
        status,
        guestCount,
        totalAmount: 100000,
        depositAmount: 30000,
        guestFullName: 'Huésped Filtros',
        guestDni: '30111222',
        ...extra,
      });

    /** Búsqueda del bot: guarda las fechas como DD-MM-YYYY. */
    const search = (
      telegramUserId: string,
      [checkInOffset, checkOutOffset]: [number, number],
      capacity: number,
    ) =>
      em.create(BookingProcess, {
        telegramUserId,
        step: BookingProcessStep.PENDING_CONFIRMATION,
        checkIn: addDays(today, checkInOffset).split('-').reverse().join('-'),
        checkOut: addDays(today, checkOutOffset).split('-').reverse().join('-'),
        capacity,
      });

    beforeAll(async () => {
      today = zonedDateKey(
        new Date(),
        app.get(SupportHoursService).getTimeZone(),
      );
      for (const filter of measured())
        baseline.set(JSON.stringify(filter), await count(filter));

      const { CONFIRMED, PENDING_PAYMENT, CANCELLED } = ReservationStatus;
      em.persist([
        ...Object.values(stay).map((telegramUserId) =>
          em.create(ChatSession, { telegramUserId }),
        ),
        stayReservation(stay.inHouse, CONFIRMED, [-1, 2], 2),
        stayReservation(stay.upcoming, CONFIRMED, [10, 12], 4),
        stayReservation(stay.finished, CONFIRMED, [-10, -7], 2),
        stayReservation(stay.unpaidPending, PENDING_PAYMENT, [30, 32], 2),
        // Vencida sin pago: el cron la cancela sin cancelledAt.
        stayReservation(stay.unpaidExpired, CANCELLED, [40, 42], 3),
        stayReservation(stay.cancelledByGuest, CANCELLED, [50, 52], 2, {
          cancelledAt: new Date(),
          mpPaymentId: 'mp-campaign-filters',
        }),
        stayReservation(stay.mixed, CONFIRMED, [-20, -18], 1),
        stayReservation(stay.mixed, CANCELLED, [60, 62], 4),
        stayReservation(stay.legacy, CONFIRMED, [-30, -28], null),
        search(stay.quoted, [15, 17], 3),
        search(stay.quotedSmall, [40, 41], 1),
        // Consultó y después reservó: no es "consultó y no reservó".
        search(stay.upcoming, [10, 12], 3),
      ]);
      await em.flush();
    });

    it('alojados actualmente: confirmada con check-in hasta hoy y check-out posterior', async () => {
      expect(await added(filters.inHouse)).toBe(1);
    });

    it('check-in próximo: confirmadas que todavía no llegaron (las pendientes no cuentan)', async () => {
      expect(await added(filters.upcoming)).toBe(1);
    });

    it('estadía finalizada: confirmadas con check-out hasta hoy', async () => {
      expect(await added(filters.finished)).toBe(3);
    });

    it('sin pagar: pendientes de pago y vencidas sin pago, no las que canceló el huésped', async () => {
      expect(await added(filters.unpaid)).toBe(3);
    });

    it('el rango acota el check-in de las próximas y el check-out de las finalizadas (CA2)', async () => {
      expect(await added({ ...filters.upcoming, ...range(9, 11) })).toBe(1);
      expect(await added({ ...filters.upcoming, ...range(20, 30) })).toBe(0);
      expect(await added({ ...filters.finished, ...range(-8, -6) })).toBe(1);
    });

    it('la cantidad de personas se mide sobre la misma reserva que cumple el estado', async () => {
      // "mixed" pidió para 4 sin pagar, pero su estadía finalizada fue de 1 persona.
      expect(await added({ ...filters.finished, minGuests: 3 })).toBe(0);
      expect(await added({ ...filters.finished, maxGuests: 2 })).toBe(3);
      expect(await added({ ...filters.unpaid, minGuests: 4 })).toBe(1);
    });

    it('si la reserva no tiene la cantidad de personas, usa la capacidad de la habitación', async () => {
      // "finished" pidió para 2 y "legacy" no tiene el dato pero su habitación es para 2.
      expect(
        await added({ ...filters.finished, minGuests: 2, maxGuests: 2 }),
      ).toBe(2);
    });

    it('consultaron y no reservaron: tienen una búsqueda del bot y ninguna reserva', async () => {
      expect(await added(filters.quoted)).toBe(2);
      expect(
        await added({
          ...filters.quoted,
          audience: CampaignAudience.CONFIRMED,
        }),
      ).toBe(0);
    });

    it('en las consultas, personas y fechas se miden sobre lo que pidieron', async () => {
      expect(await added({ ...filters.quoted, minGuests: 2 })).toBe(1);
      expect(await added({ ...filters.quoted, ...range(10, 20) })).toBe(1);
      expect(
        await added({ ...filters.quoted, ...range(10, 20), maxGuests: 2 }),
      ).toBe(0);
    });

    it('sin estado, la cantidad de personas mira cualquier reserva', async () => {
      expect(
        await added({
          audience: CampaignAudience.ALL,
          minGuests: 4,
          maxGuests: 4,
        }),
      ).toBe(2);
    });

    it('se combina con los destinatarios existentes (CA3)', async () => {
      // "mixed" tiene una reserva confirmada, así que no está entre los "sin reserva".
      expect(
        await added({
          ...filters.unpaid,
          audience: CampaignAudience.NO_RESERVATION,
        }),
      ).toBe(2);
      expect(
        await added({
          ...filters.inHouse,
          audience: CampaignAudience.NO_RESERVATION,
        }),
      ).toBe(0);
    });

    it.each<[string, RecipientFilter, RegExp]>([
      [
        'fechas con un estado que no las admite',
        { ...filters.inHouse, stayFrom: '2026-01-01' },
        /rango de fechas/,
      ],
      [
        'fechas sin estado',
        { audience: CampaignAudience.ALL, stayTo: '2026-01-01' },
        /rango de fechas/,
      ],
      [
        '"desde" posterior a "hasta"',
        { ...filters.finished, stayFrom: '2026-02-01', stayTo: '2026-01-01' },
        /posterior/,
      ],
      [
        'un mínimo de personas mayor al máximo',
        { ...filters.finished, minGuests: 4, maxGuests: 2 },
        /mínima/,
      ],
    ])('rechaza %s', async (_case, filter, message) => {
      await expect(service.countRecipients(filter)).rejects.toThrow(message);
    });

    it('envía solo a quienes cumplen los filtros y los deja en el historial (CA5)', async () => {
      const filter = {
        audience: CampaignAudience.NO_RESERVATION,
        stayFilter: CampaignStayFilter.UNPAID,
        minGuests: 3,
      };
      const expected = await count(filter);

      const created = await service.create(
        { title: 'Volvé', message: 'Te guardamos el precio', ...filter },
        undefined,
        admin,
      );
      await service.whenIdle();

      expect(created).toMatchObject({
        audience: CampaignAudience.NO_RESERVATION,
        stayFilter: CampaignStayFilter.UNPAID,
        stayFrom: null,
        stayTo: null,
        minGuests: 3,
        maxGuests: null,
        totalRecipients: expected,
      });
      const recipients = sendMessage.mock.calls.map(([chatId]) => chatId);
      expect(recipients).toContain(stay.unpaidExpired);
      expect(recipients).not.toContain(stay.unpaidPending);
      expect(recipients).not.toContain(stay.mixed);

      const [latest] = (await service.list({ page: 1, pageSize: 1 })).data;
      expect(latest).toMatchObject({
        id: created.id,
        stayFilter: CampaignStayFilter.UNPAID,
        minGuests: 3,
      });
    });

    it('no crea la campaña si ningún contacto cumple los filtros (CA4)', async () => {
      await expect(
        service.create(
          {
            title: 'Nadie',
            message: 'x',
            audience: CampaignAudience.NO_RESERVATION,
            stayFilter: CampaignStayFilter.IN_HOUSE,
          },
          undefined,
          admin,
        ),
      ).rejects.toThrow(/Ningún contacto/);
    });
  });
});
