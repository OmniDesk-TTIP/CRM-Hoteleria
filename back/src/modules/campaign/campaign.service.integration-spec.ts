import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { CampaignService } from './campaign.service';
import { AuthUser } from '../auth/auth.types';
import {
  Campaign,
  CampaignAudience,
  CampaignStatus,
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

  const counts = async () => ({
    all: (await service.countRecipients(CampaignAudience.ALL)).count,
    confirmed: (await service.countRecipients(CampaignAudience.CONFIRMED))
      .count,
    noReservation: (
      await service.countRecipients(CampaignAudience.NO_RESERVATION)
    ).count,
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
});
