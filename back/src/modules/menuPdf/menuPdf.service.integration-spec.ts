import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { RestaurantService } from '../restaurant/restaurant.service';
import { MenuPdfService } from './menuPdf.service';
import {
  MENU_PDF_TEXTS,
  MenuPdfContent,
  MenuPdfKind,
  SPA_PRICE_NOTE,
} from './menuPdf.model';
import { renderMenuPdf } from './menuPdf.renderer';
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
  RestaurantSettings,
  RestaurantStatus,
} from '../../infrastructure/database/entities/RestaurantSettings.entity';
import {
  MenuItemStatus,
  RestaurantMenuItem,
} from '../../infrastructure/database/entities/RestaurantMenuItem.entity';
import {
  SpaService as SpaServiceEntity,
  SpaServiceStatus,
} from '../../infrastructure/database/entities/SpaService.entity';

jest.mock('./menuPdf.renderer', () => ({ renderMenuPdf: jest.fn() }));

describe('MenuPdfService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: MenuPdfService;
  let restaurantService: RestaurantService;

  const renderMock = renderMenuPdf as jest.MockedFunction<typeof renderMenuPdf>;
  const PDF = Buffer.from('%PDF-test');

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
  const ALL_KINDS = Object.values(MenuPdfKind);

  let categoryId: string;
  let roomId: string;
  const reservationIds: string[] = [];
  const dishIds: string[] = [];
  const spaIds: string[] = [];

  let settingsId: string;
  let createdSettings = false;
  let previousSettings: Pick<
    RestaurantSettings,
    | 'status'
    | 'roomServiceEnabled'
    | 'roomServiceOpensAt'
    | 'roomServiceClosesAt'
  > | null = null;

  let steak: RestaurantMenuItem;
  let coffee: RestaurantMenuItem;
  let disabledDish: RestaurantMenuItem;
  let massage: SpaServiceEntity;
  let disabledSpa: SpaServiceEntity;

  const seedGuest = async (
    checkIn = new Date(2099, 2, 10, 12),
    checkOut = new Date(2099, 2, 20, 12),
  ) => {
    const telegramUserId = `tg-menu-pdf-${next()}`;
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn,
      checkOut,
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana Carta',
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    reservationIds.push(reservation.id);
    return telegramUserId;
  };

  const seedDish = async (overrides: Partial<RestaurantMenuItem> = {}) => {
    const dish = em.create(RestaurantMenuItem, {
      name: `Plato pdf ${next()}`,
      description: 'Con guarnición',
      category: 'Pdf principales',
      price: 9000,
      status: MenuItemStatus.ACTIVE,
      availableForRoomService: false,
      ...overrides,
    });
    em.persist(dish);
    await em.flush();
    dishIds.push(dish.id);
    return dish;
  };

  const seedSpa = async (overrides: Partial<SpaServiceEntity> = {}) => {
    const spa = em.create(SpaServiceEntity, {
      name: `Masaje pdf ${next()}`,
      description: 'Descontracturante',
      durationMinutes: 50,
      price: 20000,
      status: SpaServiceStatus.ACTIVE,
      availableWeekdays: [1, 2, 3, 4, 5],
      opensAt: '10:00',
      closesAt: '20:00',
      ...overrides,
    });
    em.persist(spa);
    await em.flush();
    spaIds.push(spa.id);
    return spa;
  };

  const setRestaurant = (changes: Partial<RestaurantSettings>) =>
    em.nativeUpdate(RestaurantSettings, { id: settingsId }, changes);

  const adminContent = async (kind: MenuPdfKind): Promise<MenuPdfContent> => {
    await service.buildForAdmin(kind, NOW);
    return renderMock.mock.calls[renderMock.mock.calls.length - 1][0];
  };

  const itemsOf = (content: MenuPdfContent) =>
    content.sections.flatMap((section) => section.items);

  const namesOf = (content: MenuPdfContent) =>
    itemsOf(content).map((item) => item.name);

  const withNothingEnabled = async (work: () => Promise<void>) => {
    const fork = em.fork();
    const dishes = await fork.find(RestaurantMenuItem, {
      status: MenuItemStatus.ACTIVE,
    });
    const spas = await fork.find(SpaServiceEntity, {
      status: SpaServiceStatus.ACTIVE,
    });
    const activeDishes = { id: { $in: dishes.map(({ id }) => id) } };
    const activeSpas = { id: { $in: spas.map(({ id }) => id) } };

    await em.nativeUpdate(RestaurantMenuItem, activeDishes, {
      status: MenuItemStatus.INACTIVE,
    });
    await em.nativeUpdate(SpaServiceEntity, activeSpas, {
      status: SpaServiceStatus.INACTIVE,
    });
    try {
      await work();
    } finally {
      await em.nativeUpdate(RestaurantMenuItem, activeDishes, {
        status: MenuItemStatus.ACTIVE,
      });
      await em.nativeUpdate(SpaServiceEntity, activeSpas, {
        status: SpaServiceStatus.ACTIVE,
      });
    }
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
        telegram: { sendMessage: jest.fn() },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(MenuPdfService);
    restaurantService = app.get(RestaurantService);

    const category = em.create(RoomCategory, {
      name: `Cat menu-pdf ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `MP-${suffix}`,
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
        status: settings.status,
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

    steak = await seedDish({ price: 24500.5 });
    coffee = await seedDish({
      category: 'Pdf cafetería',
      price: 1500,
      availableForRoomService: true,
    });
    disabledDish = await seedDish({
      status: MenuItemStatus.INACTIVE,
      availableForRoomService: true,
    });
    massage = await seedSpa();
    disabledSpa = await seedSpa({ status: SpaServiceStatus.INACTIVE });
  });

  beforeEach(async () => {
    orm.em.clear();
    renderMock.mockReset();
    renderMock.mockResolvedValue(PDF);
    await setRestaurant({
      status: RestaurantStatus.ACTIVE,
      roomServiceEnabled: true,
      roomServiceOpensAt: '07:00',
      roomServiceClosesAt: '23:00',
    });
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(RestaurantMenuItem, { id: { $in: dishIds } });
      await em.nativeDelete(SpaServiceEntity, { id: { $in: spaIds } });
      if (createdSettings) {
        await em.nativeDelete(RestaurantSettings, { id: settingsId });
      } else if (previousSettings) {
        await setRestaurant(previousSettings);
      }
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
    } finally {
      if (app) await app.close();
    }
  });

  describe('contenido de cada carta (CA2/CA4/CA5)', () => {
    it('la del restó trae los platos habilitados por categoría, con descripción y precio', async () => {
      const content = await adminContent(MenuPdfKind.RESTAURANT);

      expect(namesOf(content)).toEqual(
        expect.arrayContaining([steak.name, coffee.name]),
      );
      expect(namesOf(content)).not.toContain(disabledDish.name);
      expect(itemsOf(content)).toContainEqual({
        name: steak.name,
        description: 'Con guarnición',
        price: 24500.5,
      });
      expect(content.sections.map(({ category }) => category)).toEqual(
        expect.arrayContaining(['Pdf principales', 'Pdf cafetería']),
      );
    });

    it('la de room service trae solo los platos habilitados para room service', async () => {
      const content = await adminContent(MenuPdfKind.ROOM_SERVICE);

      expect(namesOf(content)).toContain(coffee.name);
      expect(namesOf(content)).not.toContain(steak.name);
      expect(namesOf(content)).not.toContain(disabledDish.name);
    });

    it('la del spa trae los servicios habilitados con su duración', async () => {
      const content = await adminContent(MenuPdfKind.SPA);

      expect(itemsOf(content)).toContainEqual({
        name: massage.name,
        description: 'Descontracturante',
        price: 20000,
        durationMinutes: 50,
      });
      expect(namesOf(content)).not.toContain(disabledSpa.name);
      expect(content.note).toBe(SPA_PRICE_NOTE);
    });

    it('indica el hotel, la fecha de actualización y los horarios del restó y de room service', async () => {
      const restaurant = await adminContent(MenuPdfKind.RESTAURANT);
      const roomService = await adminContent(MenuPdfKind.ROOM_SERVICE);

      expect(restaurant.hotelName).toEqual(expect.any(String));
      expect(restaurant.hotelName).not.toBe('');
      expect(restaurant.updatedOn).toBe('15/03/2099');
      expect(restaurant.schedule).toMatch(/de \d{2}:\d{2} a \d{2}:\d{2}/);
      expect(roomService.schedule).toBe('Todos los días de 07:00 a 23:00');
    });
  });

  it('los cambios del panel se ven en la siguiente carta (CA3)', async () => {
    const dish = await seedDish({ price: 5000 });
    const before = await adminContent(MenuPdfKind.RESTAURANT);
    expect(itemsOf(before)).toContainEqual(
      expect.objectContaining({ name: dish.name, price: 5000 }),
    );

    await restaurantService.updateMenuItem(dish.id, { price: 6500 });
    await restaurantService.updateMenuItem(steak.id, {
      status: MenuItemStatus.INACTIVE,
    });

    try {
      const after = await adminContent(MenuPdfKind.RESTAURANT);
      expect(itemsOf(after)).toContainEqual(
        expect.objectContaining({ name: dish.name, price: 6500 }),
      );
      expect(namesOf(after)).not.toContain(steak.name);
    } finally {
      await restaurantService.updateMenuItem(steak.id, {
        status: MenuItemStatus.ACTIVE,
      });
    }
  });

  describe('a quién se le envía (CA1/CA6)', () => {
    it.each(ALL_KINDS)('al huésped alojado le envía %s', async (kind) => {
      const guest = await seedGuest();

      const result = await service.buildForGuest(kind, guest, NOW);

      expect(result).toEqual({
        ok: true,
        reply: expect.stringContaining('PDF'),
        document: { source: PDF, filename: MENU_PDF_TEXTS[kind].filename },
      });
    });

    it.each([
      [MenuPdfKind.RESTAURANT, true],
      [MenuPdfKind.SPA, true],
      [MenuPdfKind.ROOM_SERVICE, false],
    ])(
      'con reserva confirmada que todavía no empezó, %s se envía: %p',
      async (kind, expected) => {
        const guest = await seedGuest(
          new Date(2099, 2, 16, 12),
          new Date(2099, 2, 20, 12),
        );

        const result = await service.buildForGuest(kind, guest, NOW);

        expect(result.ok).toBe(expected);
      },
    );

    it.each(ALL_KINDS)(
      'a quien no es huésped no le envía %s y le explica por qué',
      async (kind) => {
        const result = await service.buildForGuest(
          kind,
          `tg-menu-pdf-none-${next()}`,
          NOW,
        );

        expect(result).toEqual({
          ok: false,
          reason: MENU_PDF_TEXTS[kind].notEligible,
        });
        expect(renderMock).not.toHaveBeenCalled();
      },
    );

    it.each([
      [MenuPdfKind.RESTAURANT, { status: RestaurantStatus.INACTIVE }],
      [MenuPdfKind.ROOM_SERVICE, { roomServiceEnabled: false }],
    ])(
      'con el servicio deshabilitado no envía %s, pero el admin la previsualiza',
      async (kind, changes) => {
        const guest = await seedGuest();
        await setRestaurant(changes);

        const result = await service.buildForGuest(kind, guest, NOW);
        const preview = await service.buildForAdmin(kind, NOW);

        expect(result).toEqual({
          ok: false,
          reason: MENU_PDF_TEXTS[kind].unavailable,
        });
        expect(preview.source).toBe(PDF);
      },
    );
  });

  describe('sin ítems habilitados (CA7)', () => {
    it.each(ALL_KINDS)(
      'no genera %s: se lo informa al huésped y al admin',
      async (kind) => {
        const guest = await seedGuest();

        await withNothingEnabled(async () => {
          const result = await service.buildForGuest(kind, guest, NOW);

          expect(result).toEqual({
            ok: false,
            reason: MENU_PDF_TEXTS[kind].empty,
          });
          await expect(service.buildForAdmin(kind, NOW)).rejects.toThrow(
            ConflictException,
          );
          expect(renderMock).not.toHaveBeenCalled();
        });
      },
    );
  });
});
