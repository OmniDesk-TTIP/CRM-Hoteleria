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
import { RoomServiceService } from './roomService.service';
import { AccountService } from '../account/account.service';
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
import { User } from '../../infrastructure/database/entities/User.entity';
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
  MenuItemStatus,
  RestaurantMenuItem,
} from '../../infrastructure/database/entities/RestaurantMenuItem.entity';
import { RestaurantSettings } from '../../infrastructure/database/entities/RestaurantSettings.entity';
import {
  ChatMessage,
  MessageRole,
} from '../../infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../../infrastructure/database/entities/ChatSession.entity';
import {
  RoomServiceOrder,
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../../infrastructure/database/entities/RoomServiceOrder.entity';

describe('RoomServiceService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: RoomServiceService;

  const sendMessage = jest.fn();
  const createRoomServicePreference = jest.fn();
  const getPayment = jest.fn();

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
  const NIGHT = new Date(Date.UTC(2099, 2, 15, 5, 0));
  const INIT_POINT = 'https://mp.example/pagar-room-service';
  const GUEST_NAME = 'Ana Room Service';

  let categoryId: string;
  let roomId: string;
  let roomNumber: string;
  const clientIds: string[] = [];
  const reservationIds: string[] = [];
  const menuItemIds: string[] = [];

  let settingsId: string;
  let createdSettings = false;
  let previousSettings: Pick<
    RestaurantSettings,
    'roomServiceEnabled' | 'roomServiceOpensAt' | 'roomServiceClosesAt'
  > | null = null;

  let receptionist: User | undefined;

  let coffee: RestaurantMenuItem;
  let burger: RestaurantMenuItem;
  let notForRoom: RestaurantMenuItem;
  let disabled: RestaurantMenuItem;

  const seedGuest = async (
    checkIn = new Date(2099, 2, 10, 12),
    checkOut = new Date(2099, 2, 20, 12),
    status = ReservationStatus.CONFIRMED,
  ) => {
    const telegramUserId = `tg-room-service-${next()}`;
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn,
      checkOut,
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

  const seedMenuItem = async (overrides: Partial<RestaurantMenuItem> = {}) => {
    const item = em.create(RestaurantMenuItem, {
      name: `Plato <rs> ${next()}`,
      category: 'Room service test',
      price: 1000,
      status: MenuItemStatus.ACTIVE,
      availableForRoomService: true,
      ...overrides,
    });
    em.persist(item);
    await em.flush();
    menuItemIds.push(item.id);
    return item;
  };

  const setHours = (enabled: boolean, opensAt = '07:00', closesAt = '23:00') =>
    em.nativeUpdate(
      RestaurantSettings,
      { id: settingsId },
      {
        roomServiceEnabled: enabled,
        roomServiceOpensAt: opensAt,
        roomServiceClosesAt: closesAt,
      },
    );

  const rowById = (id: string) =>
    em.fork().findOneOrFail(RoomServiceOrder, { id });

  const rowsOf = (telegramUserId: string) =>
    em.fork().find(RoomServiceOrder, { telegramUserId });

  const prepare = (
    telegramUserId: string,
    items: { menuItemId: string; quantity: number; notes?: string }[],
    now = NOW,
    notes?: string,
  ) => service.prepareOrder(telegramUserId, { items, notes }, now);

  const placeOrder = async (telegramUserId: string) => {
    const draft = await prepare(telegramUserId, [
      { menuItemId: coffee.id, quantity: 2 },
    ]);
    if (!draft.ok || !draft.orderId) throw new Error('No se armó el pedido');
    const confirmed = await service.confirmOrder(
      telegramUserId,
      draft.orderId,
      NOW,
    );
    if (!confirmed.ok) throw new Error(confirmed.reason);
    return draft.orderId;
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
        createRoomServicePreference,
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
        action: jest.fn(),
        telegram: { sendMessage },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(RoomServiceService);

    roomNumber = `RS-${suffix}`;
    const category = em.create(RoomCategory, {
      name: `Cat room-service ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;

    const [settings] = await em.find(
      RestaurantSettings,
      {},
      { orderBy: { createdAt: 'asc' }, limit: 1 },
    );
    if (settings) {
      settingsId = settings.id;
      previousSettings = {
        roomServiceEnabled: settings.roomServiceEnabled,
        roomServiceOpensAt: settings.roomServiceOpensAt,
        roomServiceClosesAt: settings.roomServiceClosesAt,
      };
    } else {
      const created = em.create(RestaurantSettings, {
        availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
        shifts: [{ opensAt: '12:00', closesAt: '15:00' }],
      });
      em.persist(created);
      await em.flush();
      settingsId = created.id;
      createdSettings = true;
    }

    coffee = await seedMenuItem({ price: 1500.5 });
    burger = await seedMenuItem({ price: 9000 });
    notForRoom = await seedMenuItem({ availableForRoomService: false });
    disabled = await seedMenuItem({ status: MenuItemStatus.INACTIVE });
  });

  beforeEach(async () => {
    orm.em.clear();
    await setHours(true);
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
    createRoomServicePreference.mockReset();
    createRoomServicePreference.mockResolvedValue({
      preferenceId: 'pref-rs',
      initPoint: INIT_POINT,
    });
    getPayment.mockReset();
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
      if (receptionist) await em.nativeDelete(User, { id: receptionist.id });
      await em.nativeDelete(ChatMessage, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(ChatSession, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(RoomServiceOrder, {
        telegramUserId: { $in: clientIds },
      });
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(RestaurantMenuItem, { id: { $in: menuItemIds } });
      if (createdSettings) {
        await em.nativeDelete(RestaurantSettings, { id: settingsId });
      } else if (previousSettings) {
        await em.nativeUpdate(
          RestaurantSettings,
          { id: settingsId },
          previousSettings,
        );
      }
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
    } finally {
      if (app) await app.close();
    }
  });

  describe('quién puede pedir (CA1)', () => {
    it('al huésped alojado le ofrece room service con su habitación', async () => {
      const guest = await seedGuest();

      const context = await service.getChatContext(guest.telegramUserId, NOW);

      expect(context.canOrder).toBe(true);
      expect(context.block).toContain('HUÉSPED ALOJADO');
      expect(context.block).toContain(roomNumber);
    });

    it.each([
      ['sin reserva', null],
      [
        'con reserva futura',
        [new Date(2099, 2, 16, 12), new Date(2099, 2, 20, 12)],
      ],
      [
        'con la estadía terminada',
        [new Date(2099, 2, 1, 12), new Date(2099, 2, 14, 12)],
      ],
    ])('no se lo ofrece ni le toma pedidos %s', async (_label, stay) => {
      let telegramUserId = `tg-room-service-none-${next()}`;
      if (stay) {
        telegramUserId = (await seedGuest(stay[0], stay[1])).telegramUserId;
      } else {
        clientIds.push(telegramUserId);
      }

      const context = await service.getChatContext(telegramUserId, NOW);
      expect(context.canOrder).toBe(false);
      expect(context.block).toContain('NO es huésped alojado');
      expect(context.block).not.toContain(coffee.id);

      const result = await prepare(telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining('exclusivo para huéspedes alojados'),
      });
      expect(await rowsOf(telegramUserId)).toHaveLength(0);
    });

    it('una reserva sin confirmar no habilita el room service', async () => {
      const guest = await seedGuest(
        undefined,
        undefined,
        ReservationStatus.PENDING_PAYMENT,
      );

      const context = await service.getChatContext(guest.telegramUserId, NOW);
      expect(context.canOrder).toBe(false);
    });
  });

  describe('carta (CA2)', () => {
    it('Chamber ve solo los platos habilitados y marcados para room service', async () => {
      const guest = await seedGuest();

      const { block } = await service.getChatContext(guest.telegramUserId, NOW);

      expect(block).toContain(`id=${coffee.id}`);
      expect(block).toContain(`id=${burger.id}`);
      expect(block).not.toContain(notForRoom.id);
      expect(block).not.toContain(disabled.id);
    });

    it('la landing recibe la misma carta y el horario', async () => {
      const menu = await service.getPublicMenu();

      const ids = menu.menu.flatMap((section) =>
        section.items.map((item) => item.id),
      );
      expect(menu).toMatchObject({
        available: true,
        opensAt: '07:00',
        closesAt: '23:00',
      });
      expect(ids).toEqual(expect.arrayContaining([coffee.id, burger.id]));
      expect(ids).not.toContain(notForRoom.id);
      expect(ids).not.toContain(disabled.id);
    });

    it('con el room service deshabilitado la landing no muestra nada', async () => {
      await setHours(false);

      expect(await service.getPublicMenu()).toEqual({
        available: false,
        opensAt: null,
        closesAt: null,
        menu: [],
      });
    });
  });

  describe('armar el pedido (CA3/CA4)', () => {
    it('guarda un borrador con el resumen y no lo muestra en el panel', async () => {
      const guest = await seedGuest();

      const result = await prepare(
        guest.telegramUserId,
        [
          { menuItemId: coffee.id, quantity: 2, notes: 'sin azúcar' },
          { menuItemId: burger.id, quantity: 1 },
        ],
        NOW,
        'Tocar timbre',
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.orderId).toBeDefined();
      expect(result.reply).toContain(`habitación <b>${roomNumber}</b>`);
      expect(result.reply).toContain('2 x Plato &lt;rs&gt;');
      expect(result.reply).toContain('(sin azúcar)');
      expect(result.reply).toContain('Aclaraciones: Tocar timbre');
      expect(result.reply).toContain('Total: $12001');

      const row = await rowById(result.orderId!);
      expect(row.status).toBe(RoomServiceOrderStatus.PENDING_CONFIRMATION);
      expect(Number(row.total)).toBe(12001);

      const panel = await service.list({ page: 1, pageSize: 100 });
      expect(panel.items.map((item) => item.id)).not.toContain(result.orderId);
    });

    it.each([
      ['un plato inexistente', () => '00000000-0000-4000-8000-000000000000'],
      ['un plato deshabilitado', () => disabled.id],
      ['un plato que no es de room service', () => notForRoom.id],
    ])('rechaza %s', async (_label, idOf) => {
      const guest = await seedGuest();

      const result = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
        { menuItemId: idOf(), quantity: 1 },
      ]);

      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining('no está disponible'),
      });
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });

    it('un resumen nuevo reemplaza al anterior', async () => {
      const guest = await seedGuest();

      await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      const second = await prepare(guest.telegramUserId, [
        { menuItemId: burger.id, quantity: 1 },
      ]);

      const rows = await rowsOf(guest.telegramUserId);
      expect(rows).toHaveLength(1);
      expect(second.ok && rows[0].id === second.orderId).toBe(true);
    });
  });

  describe('confirmar el pedido (CA4/CA6/CA9)', () => {
    it('queda Recibido, asociado a la reserva, con link de pago', async () => {
      const guest = await seedGuest();
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: burger.id, quantity: 2 },
      ]);
      if (!draft.ok) throw new Error(draft.reason);

      const result = await service.confirmOrder(
        guest.telegramUserId,
        draft.orderId!,
        NOW,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.reply).toContain(INIT_POINT);
      expect(result.reply).toContain('Total: $18000');
      expect(createRoomServicePreference).toHaveBeenCalledWith({
        id: draft.orderId,
        roomNumber,
        amount: 18000,
        fullName: GUEST_NAME,
        dni: '30111222',
      });

      const row = await em
        .fork()
        .findOneOrFail(
          RoomServiceOrder,
          { id: draft.orderId! },
          { populate: ['roomReservation'] },
        );
      expect(row.status).toBe(RoomServiceOrderStatus.RECEIVED);
      expect(row.roomReservation.id).toBe(guest.reservationId);
      expect(row.mpInitPoint).toBe(INIT_POINT);
      expect(row.confirmedAt).toEqual(NOW);

      const panel = await service.list({
        status: RoomServiceOrderStatus.RECEIVED,
        page: 1,
        pageSize: 100,
      });
      expect(panel.items.find((item) => item.id === draft.orderId)).toEqual(
        expect.objectContaining({
          guestFullName: GUEST_NAME,
          roomNumber,
          total: 18000,
          confirmedAt: NOW.toISOString(),
          status: RoomServiceOrderStatus.RECEIVED,
          paymentStatus: RoomServicePaymentStatus.PENDING,
          items: [expect.objectContaining({ menuItemId: burger.id })],
        }),
      );
    });

    it('si Mercado Pago falla, el pedido queda registrado igual', async () => {
      const guest = await seedGuest();
      createRoomServicePreference.mockRejectedValue(new Error('MP caído'));
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      if (!draft.ok) throw new Error(draft.reason);

      const result = await service.confirmOrder(
        guest.telegramUserId,
        draft.orderId!,
        NOW,
      );

      expect(result.ok && result.reply).toContain('No pude generar el link');
      expect((await rowById(draft.orderId!)).status).toBe(
        RoomServiceOrderStatus.RECEIVED,
      );
    });

    it('no confirma dos veces ni el pedido de otro huésped', async () => {
      const guest = await seedGuest();
      const other = await seedGuest();
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      if (!draft.ok) throw new Error(draft.reason);

      const stolen = await service.confirmOrder(
        other.telegramUserId,
        draft.orderId!,
        NOW,
      );
      expect(stolen.ok).toBe(false);

      await service.confirmOrder(guest.telegramUserId, draft.orderId!, NOW);
      const again = await service.confirmOrder(
        guest.telegramUserId,
        draft.orderId!,
        NOW,
      );
      expect(again).toEqual({
        ok: false,
        reason: 'Ese pedido ya estaba confirmado.',
      });
      expect(createRoomServicePreference).toHaveBeenCalledTimes(1);
    });

    it('"No, gracias" descarta el borrador', async () => {
      const guest = await seedGuest();
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      if (!draft.ok) throw new Error(draft.reason);

      const result = await service.discardDraft(
        guest.telegramUserId,
        draft.orderId!,
      );

      expect(result.ok).toBe(true);
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });
  });

  describe('horario (CA5)', () => {
    it('fuera de horario informa el horario y no toma el pedido', async () => {
      const guest = await seedGuest();

      const context = await service.getChatContext(guest.telegramUserId, NIGHT);
      expect(context.canOrder).toBe(false);
      expect(context.block).toContain('CERRADO');

      const result = await prepare(
        guest.telegramUserId,
        [{ menuItemId: coffee.id, quantity: 1 }],
        NIGHT,
      );
      expect(result).toEqual({
        ok: false,
        reason:
          'En este momento el room service está cerrado. Atiende todos los días de 07:00 a 23:00.',
      });
      expect(await rowsOf(guest.telegramUserId)).toHaveLength(0);
    });

    it('una franja que cruza la medianoche atiende de madrugada', async () => {
      await setHours(true, '22:00', '04:00');
      const guest = await seedGuest();

      const result = await prepare(
        guest.telegramUserId,
        [{ menuItemId: coffee.id, quantity: 1 }],
        NIGHT,
      );
      expect(result.ok).toBe(true);
    });

    it('no confirma un resumen si mientras tanto cerró', async () => {
      const guest = await seedGuest();
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      if (!draft.ok) throw new Error(draft.reason);
      await setHours(false);

      const result = await service.confirmOrder(
        guest.telegramUserId,
        draft.orderId!,
        NOW,
      );
      expect(result.ok).toBe(false);
      expect((await rowById(draft.orderId!)).status).toBe(
        RoomServiceOrderStatus.PENDING_CONFIRMATION,
      );
    });
  });

  describe('estados desde el panel (CA7)', () => {
    it('cada cambio avisa al huésped por Chamber y queda en el chat', async () => {
      const guest = await seedGuest();
      const orderId = await placeOrder(guest.telegramUserId);

      await service.changeStatus(
        orderId,
        RoomServiceOrderStatus.IN_PREPARATION,
      );
      const delivered = await service.changeStatus(
        orderId,
        RoomServiceOrderStatus.DELIVERED,
      );

      expect(delivered.status).toBe(RoomServiceOrderStatus.DELIVERED);
      expect(sendMessage).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenNthCalledWith(
        1,
        guest.telegramUserId,
        expect.stringContaining('en preparación'),
      );
      expect(sendMessage).toHaveBeenNthCalledWith(
        2,
        guest.telegramUserId,
        expect.stringContaining(`entregado en la habitación ${roomNumber}`),
      );

      const notices = await em.fork().find(ChatMessage, {
        telegramUserId: guest.telegramUserId,
        role: MessageRole.SYSTEM,
      });
      expect(notices).toHaveLength(2);
    });

    it('rechaza transiciones inválidas y pedidos inexistentes', async () => {
      const guest = await seedGuest();
      const orderId = await placeOrder(guest.telegramUserId);

      await expect(
        service.changeStatus(orderId, RoomServiceOrderStatus.DELIVERED),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.changeStatus(
          '00000000-0000-4000-8000-000000000000',
          RoomServiceOrderStatus.IN_PREPARATION,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('un borrador no se gestiona desde el panel', async () => {
      const guest = await seedGuest();
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      if (!draft.ok) throw new Error(draft.reason);

      await expect(
        service.changeStatus(
          draft.orderId!,
          RoomServiceOrderStatus.IN_PREPARATION,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancelación por el huésped (CA8)', () => {
    it('Recibido: pide confirmación y recién con el botón lo cancela', async () => {
      const guest = await seedGuest();
      const orderId = await placeOrder(guest.telegramUserId);

      const question = await service.requestCancel(guest.telegramUserId);
      expect(question).toEqual({
        ok: true,
        orderId,
        reply: expect.stringContaining('¿Seguro que querés cancelar'),
      });
      expect((await rowById(orderId)).status).toBe(
        RoomServiceOrderStatus.RECEIVED,
      );

      const result = await service.cancelOrder(guest.telegramUserId, orderId);
      expect(result.ok).toBe(true);
      expect((await rowById(orderId)).status).toBe(
        RoomServiceOrderStatus.CANCELLED,
      );
    });

    it('En preparación: informa que ya no se puede cancelar', async () => {
      const guest = await seedGuest();
      const orderId = await placeOrder(guest.telegramUserId);
      await service.changeStatus(
        orderId,
        RoomServiceOrderStatus.IN_PREPARATION,
      );

      const question = await service.requestCancel(guest.telegramUserId);
      const result = await service.cancelOrder(guest.telegramUserId, orderId);

      for (const answer of [question, result]) {
        expect(answer).toEqual({
          ok: false,
          reason: expect.stringContaining('ya está en preparación'),
        });
      }
      expect((await rowById(orderId)).status).toBe(
        RoomServiceOrderStatus.IN_PREPARATION,
      );
    });

    it('sin pedidos en curso no hay nada para cancelar', async () => {
      const guest = await seedGuest();

      expect(await service.requestCancel(guest.telegramUserId)).toEqual({
        ok: false,
        reason: 'No tenés pedidos de room service en curso para cancelar.',
      });
    });
  });

  describe('pago (CA9)', () => {
    it('marca el pedido como pagado y avisa una sola vez', async () => {
      const guest = await seedGuest();
      const orderId = await placeOrder(guest.telegramUserId);
      getPayment.mockResolvedValue({
        id: 777,
        status: 'approved',
        external_reference: orderId,
      });

      await service.confirmPayment('777', 'webhook');
      await service.confirmPayment('777', 'back_url');

      const row = await rowById(orderId);
      expect(row.paymentStatus).toBe(RoomServicePaymentStatus.PAID);
      expect(row.mpPaymentId).toBe('777');
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        guest.telegramUserId,
        expect.stringContaining('Recibimos el pago'),
      );
    });

    it('un pago no aprobado no cambia nada', async () => {
      const guest = await seedGuest();
      const orderId = await placeOrder(guest.telegramUserId);
      getPayment.mockResolvedValue({
        id: 778,
        status: 'rejected',
        external_reference: orderId,
      });

      await service.confirmPayment('778', 'webhook');

      expect((await rowById(orderId)).paymentStatus).toBe(
        RoomServicePaymentStatus.PENDING,
      );
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('cuenta corriente (US-27)', () => {
    const openAccount = async (reservationId: string) => {
      if (!receptionist) {
        receptionist = em.create(User, {
          email: `recepcion-rs-${suffix}@test.local`,
          passwordHash: 'hash',
          fullName: 'Recepción Room Service',
        });
        em.persist(receptionist);
        await em.flush();
      }
      return app
        .get(AccountService)
        .open(reservationId, PaymentMethod.CASH, receptionist.id, NOW);
    };

    const entriesOf = async (reservationId: string) => {
      const account = await em
        .fork()
        .findOne(Account, { reservation: reservationId });
      if (!account) return [];
      return em
        .fork()
        .find(
          AccountEntry,
          { account: account.id },
          { orderBy: { registeredAt: 'asc', id: 'asc' } },
        );
    };

    // la hora de registro no sirve para ordenar acá: los cargos usan el NOW de 2099 y las
    // cancelaciones la hora real, y los movimientos de la apertura comparten la misma
    const typesOf = (entries: AccountEntry[]) =>
      entries.map((entry) => entry.type).sort();

    const balanceOf = async (reservationId: string) =>
      (await app.get(AccountService).getForReservation(reservationId)).account
        ?.balance;

    const pay = async (orderId: string, paymentId: number) => {
      getPayment.mockResolvedValue({
        id: paymentId,
        status: 'approved',
        external_reference: orderId,
      });
      await service.confirmPayment(String(paymentId), 'webhook');
    };

    it('al confirmar el pedido genera el cargo con el detalle, registrado por Chamber', async () => {
      const guest = await seedGuest();
      await openAccount(guest.reservationId);

      const orderId = await placeOrder(guest.telegramUserId);

      const [charge, ...rest] = await entriesOf(guest.reservationId);
      expect(rest).toHaveLength(0);
      expect(charge).toMatchObject({
        type: AccountEntryType.CHARGE,
        origin: AccountEntryOrigin.ROOM_SERVICE,
        sourceId: orderId,
        description: `Room service: 2 x ${coffee.name}`,
        registeredBy: null,
      });
      expect(Number(charge.amount)).toBe(3001);
      expect(await balanceOf(guest.reservationId)).toBe(3001);
    });

    it('el pago con el link entra a la cuenta una sola vez aunque el webhook se repita', async () => {
      const guest = await seedGuest();
      await openAccount(guest.reservationId);
      const orderId = await placeOrder(guest.telegramUserId);

      await pay(orderId, 901);
      await pay(orderId, 901);

      const payments = (await entriesOf(guest.reservationId)).filter(
        (entry) => entry.type === AccountEntryType.PAYMENT,
      );
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        paymentMethod: PaymentMethod.MERCADO_PAGO,
        reference: '901',
        sourceId: orderId,
      });
      expect(await balanceOf(guest.reservationId)).toBe(0);
    });

    it('si el huésped lo cancela, anula el cargo', async () => {
      const guest = await seedGuest();
      await openAccount(guest.reservationId);
      const orderId = await placeOrder(guest.telegramUserId);

      const result = await service.cancelOrder(guest.telegramUserId, orderId);

      expect(result.ok).toBe(true);
      expect(typesOf(await entriesOf(guest.reservationId))).toEqual([
        AccountEntryType.CHARGE,
        AccountEntryType.CHARGE_REVERSAL,
      ]);
      expect(await balanceOf(guest.reservationId)).toBe(0);
    });

    it('los cambios de estado del panel no repiten el cargo y la cancelación lo anula', async () => {
      const guest = await seedGuest();
      await openAccount(guest.reservationId);
      const orderId = await placeOrder(guest.telegramUserId);

      await service.changeStatus(
        orderId,
        RoomServiceOrderStatus.IN_PREPARATION,
      );
      await service.changeStatus(orderId, RoomServiceOrderStatus.CANCELLED);

      expect(typesOf(await entriesOf(guest.reservationId))).toEqual([
        AccountEntryType.CHARGE,
        AccountEntryType.CHARGE_REVERSAL,
      ]);
    });

    it('sin cuenta abierta el pedido se toma igual y no genera movimientos', async () => {
      const guest = await seedGuest();

      const orderId = await placeOrder(guest.telegramUserId);

      expect((await rowById(orderId)).status).toBe(
        RoomServiceOrderStatus.RECEIVED,
      );
      expect(await entriesOf(guest.reservationId)).toHaveLength(0);
    });

    it('una cuenta cerrada no recibe el cargo', async () => {
      const guest = await seedGuest();
      await openAccount(guest.reservationId);
      await em
        .fork()
        .nativeUpdate(
          Account,
          { reservation: guest.reservationId },
          { status: AccountStatus.CLOSED, closedAt: NOW },
        );

      await placeOrder(guest.telegramUserId);

      expect(await entriesOf(guest.reservationId)).toHaveLength(0);
    });

    it('al abrir la cuenta trae los pedidos previos: pendientes como cargo y pagados como cargo más pago', async () => {
      const guest = await seedGuest();
      const pending = await placeOrder(guest.telegramUserId);
      const paid = await placeOrder(guest.telegramUserId);
      await pay(paid, 902);
      const cancelled = await placeOrder(guest.telegramUserId);
      await service.cancelOrder(guest.telegramUserId, cancelled);

      const { account } = await openAccount(guest.reservationId);

      const entries = await entriesOf(guest.reservationId);
      expect(
        entries.map((entry) => `${entry.sourceId}:${entry.type}`).sort(),
      ).toEqual(
        [
          `${pending}:${AccountEntryType.CHARGE}`,
          `${paid}:${AccountEntryType.CHARGE}`,
          `${paid}:${AccountEntryType.PAYMENT}`,
        ].sort(),
      );
      // lo que debe hoy según el paymentStatus de cada pedido
      const owed = (await rowsOf(guest.telegramUserId))
        .filter(
          (row) =>
            // el cast saca el `Opt` de MikroORM, que el lint no reconoce como el mismo enum
            (row.status as RoomServiceOrderStatus) !==
              RoomServiceOrderStatus.CANCELLED &&
            (row.paymentStatus as RoomServicePaymentStatus) ===
              RoomServicePaymentStatus.PENDING,
        )
        .reduce((total, row) => total + Number(row.total), 0);
      expect(account?.balance).toBe(owed);

      // un evento posterior del mismo pedido no lo vuelve a cargar
      await service.changeStatus(
        pending,
        RoomServiceOrderStatus.IN_PREPARATION,
      );
      expect(await entriesOf(guest.reservationId)).toHaveLength(3);
    });

    it('abrir la cuenta mientras se confirma un pedido no lo pierde ni lo duplica', async () => {
      const guest = await seedGuest();
      const draft = await prepare(guest.telegramUserId, [
        { menuItemId: coffee.id, quantity: 1 },
      ]);
      if (!draft.ok || !draft.orderId) throw new Error('No se armó el pedido');

      await Promise.all([
        service.confirmOrder(guest.telegramUserId, draft.orderId, NOW),
        openAccount(guest.reservationId),
      ]);

      const charges = (await entriesOf(guest.reservationId)).filter(
        (entry) => entry.type === AccountEntryType.CHARGE,
      );
      expect(charges).toHaveLength(1);
      expect(charges[0].sourceId).toBe(draft.orderId);
    });
  });
});
