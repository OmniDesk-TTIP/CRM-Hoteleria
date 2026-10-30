import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { RoomService } from './room.service';
import { Room } from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';

// El CRUD (listar, crear con tipo nuevo, número repetido, editar número, precio compartido por
// tipo, deshabilitar, baja lógica y 404) ya lo cubre test/room-admin.e2e-spec.ts. Acá queda cómo
// el service resuelve el tipo de habitación por nombre.
describe('RoomService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: RoomService;

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;
  /** Nombre de tipo propio de cada test, para que no dependan del orden. */
  const uniqueCategory = (label: string) => `${label} Int ${next()}`;

  const createRoom = (categoryName: string) =>
    service.create({
      roomNumber: `INT-${next()}`,
      categoryName,
      capacity: 2,
      basePrice: 12000,
    });

  const categoryOf = async (roomId: string) =>
    (
      await em
        .fork()
        .findOneOrFail(Room, { id: roomId }, { populate: ['category'] })
    ).category;

  const categoriesNamed = (name: string) =>
    em.fork().count(RoomCategory, { name: { $ilike: name } });

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
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(RoomService);
  });

  beforeEach(() => {
    // El service usa el EntityManager global: sin esto podría devolver filas cacheadas de otro test.
    orm.em.clear();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Room, { roomNumber: { $like: `INT-${suffix}-%` } });
      await em.nativeDelete(RoomCategory, {
        name: { $like: `% Int ${suffix}-%` },
      });
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  describe('create', () => {
    it('reutiliza el tipo aunque cambien las mayúsculas, sin pisar su capacidad ni su precio', async () => {
      const doble = uniqueCategory('Doble');
      const first = await createRoom(doble);

      const second = await service.create({
        roomNumber: `INT-${next()}`,
        categoryName: doble.toUpperCase(),
        capacity: 99,
        basePrice: 999999,
      });

      expect(second).toMatchObject({
        categoryId: first.categoryId,
        categoryName: doble,
        capacity: 2,
        basePrice: 12000,
      });
      expect(await categoriesNamed(doble)).toBe(1);
    });
  });

  describe('update', () => {
    it('al cambiar a un tipo existente lo reutiliza y no modifica el tipo anterior', async () => {
      const suiteName = uniqueCategory('Suite');
      const dobleName = uniqueCategory('Doble');
      const suite = await createRoom(suiteName);
      const room = await createRoom(dobleName);

      const updated = await service.update(room.id, {
        categoryName: suiteName.toLowerCase(),
      });

      expect(updated.categoryId).toBe(suite.categoryId);
      expect(await categoryOf(room.id)).toMatchObject({
        id: suite.categoryId,
      });
      expect(await categoriesNamed(suiteName)).toBe(1);
      expect(await categoriesNamed(dobleName)).toBe(1);
    });

    it('al cambiar a un tipo nuevo lo crea con la capacidad y el precio del anterior si no se mandan', async () => {
      const room = await createRoom(uniqueCategory('Doble'));
      const familiar = uniqueCategory('Familiar');

      await service.update(room.id, {
        categoryName: familiar,
        basePrice: 30000,
      });

      const category = await categoryOf(room.id);
      expect(category.name).toBe(familiar);
      expect(category.capacity).toBe(2);
      expect(Number(category.basePrice)).toBe(30000);
    });

    it('el mismo tipo con otras mayúsculas no es un cambio de tipo: edita el actual', async () => {
      const doble = uniqueCategory('Doble');
      const room = await createRoom(doble);

      const updated = await service.update(room.id, {
        categoryName: doble.toUpperCase(),
        capacity: 3,
      });

      expect(updated).toMatchObject({
        categoryId: room.categoryId,
        capacity: 3,
      });
      expect(await categoryOf(room.id)).toMatchObject({
        id: room.categoryId,
        capacity: 3,
      });
    });
  });
});
