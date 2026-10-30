import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { createValidationPipe } from '../src/validation.config';
import {
  Room,
  RoomStatus,
} from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';

describe('Public Rooms (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;

  const uniqueSuffix = Date.now();
  const doble = `Doble Pub-${uniqueSuffix}`;
  const suite = `Suite Pub-${uniqueSuffix}`;
  const cerrada = `Cerrada Pub-${uniqueSuffix}`;

  const seedCategory = (
    name: string,
    capacity: number,
    basePrice: number,
    statuses: RoomStatus[],
  ): RoomCategory => {
    const category = em.create(RoomCategory, { name, capacity, basePrice });
    statuses.forEach((status, i) =>
      em.create(Room, {
        roomNumber: `PUB-${uniqueSuffix}-${name.charAt(0)}${i}`,
        category,
        status,
      }),
    );
    return category;
  };

  const getPublicRooms = async () =>
    (await request(app.getHttpServer()).get('/public/rooms').expect(200))
      .body as Array<Record<string, unknown>>;

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
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    seedCategory(doble, 2, 12000, [RoomStatus.ACTIVE, RoomStatus.ACTIVE]);
    seedCategory(suite, 4, 20000, [RoomStatus.ACTIVE, RoomStatus.MAINTENANCE]);
    seedCategory(cerrada, 3, 15000, [
      RoomStatus.INACTIVE,
      RoomStatus.MAINTENANCE,
    ]);
    await em.flush();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Room, {
        roomNumber: { $like: `PUB-${uniqueSuffix}-%` },
      });
      await em.nativeDelete(RoomCategory, {
        name: { $in: [doble, suite, cerrada] },
      });
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  it('responde sin token con nombre, capacidad y precio por noche de cada tipo', async () => {
    const rooms = await getPublicRooms();

    expect(rooms.find((room) => room.name === doble)).toEqual({
      id: expect.any(String),
      name: doble,
      capacity: 2,
      pricePerNight: 12000,
      photos: [],
    });
    expect(rooms.find((room) => room.name === suite)).toMatchObject({
      capacity: 4,
      pricePerNight: 20000,
    });
  });

  it('muestra cada tipo una sola vez aunque tenga varias habitaciones activas', async () => {
    const rooms = await getPublicRooms();

    expect(rooms.filter((room) => room.name === doble)).toHaveLength(1);
  });

  it('no publica los tipos sin ninguna habitación activa', async () => {
    const rooms = await getPublicRooms();

    expect(rooms.find((room) => room.name === cerrada)).toBeUndefined();
  });

  it('ordena del más barato al más caro', async () => {
    const prices = (await getPublicRooms()).map((room) => room.pricePerNight);

    expect(prices).toEqual([...(prices as number[])].sort((a, b) => a - b));
  });

  it('refleja al instante un cambio de precio hecho desde el panel', async () => {
    await em.nativeUpdate(RoomCategory, { name: doble }, { basePrice: 13500 });

    const rooms = await getPublicRooms();

    expect(rooms.find((room) => room.name === doble)).toMatchObject({
      pricePerNight: 13500,
    });
  });
});
