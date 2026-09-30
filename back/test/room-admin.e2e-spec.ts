import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { createValidationPipe } from '../src/validation.config';
import { seedUser, bearer } from './auth.helper';
import { User, UserRole } from '../src/infrastructure/database/entities/User.entity';
import { Room, RoomStatus } from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';

describe('Admin Rooms CRUD (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const uniqueSuffix = Date.now();
  const categoryName = `Doble E2E-${uniqueSuffix}`;
  const createdRoomIds: string[] = [];
  const createdCategoryNames = [categoryName, `Suite E2E-${uniqueSuffix}`, `Familiar E2E-${uniqueSuffix}`];

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
      .useValue({ launch: jest.fn(), stop: jest.fn(), on: jest.fn(), start: jest.fn(), use: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);
  });

  afterAll(async () => {
    try {
      if (createdRoomIds.length > 0) {
        await em.nativeDelete(Room, { id: { $in: createdRoomIds } });
      }
      await em.nativeDelete(RoomCategory, { name: { $in: createdCategoryNames } });
      await em.nativeDelete(User, { email: { $in: [admin.user.email, employee.user.email] } });
      if (app) await app.close();
    } catch (e) {
      // no-op: limpieza best-effort
    }
  });

  describe('Autenticación y autorización', () => {
    it('GET /rooms sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/rooms').expect(401);
    });

    it('GET /rooms con un usuario Empleado responde 200 (lectura abierta a cualquier autenticado)', async () => {
      await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);
    });

    it('POST /rooms con un usuario Empleado responde 403 (mutaciones solo ADMIN)', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(employee.accessToken))
        .send({ roomNumber: `X-${uniqueSuffix}`, categoryName, capacity: 2, basePrice: 12000 })
        .expect(403);
    });

    it('PATCH /rooms/:id con un usuario Empleado responde 403 (mutaciones solo ADMIN)', async () => {
      await request(app.getHttpServer())
        .patch('/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', bearer(employee.accessToken))
        .send({ basePrice: 10000 })
        .expect(403);
    });

    it('DELETE /rooms/:id con un usuario Empleado responde 403 (mutaciones solo ADMIN)', async () => {
      await request(app.getHttpServer())
        .delete('/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', bearer(employee.accessToken))
        .expect(403);
    });
  });

  describe('POST /rooms (CA2)', () => {
    it('crea una habitación nueva, creando el tipo si no existía', async () => {
      const response = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `201-${uniqueSuffix}`, categoryName, capacity: 2, basePrice: 12000 })
        .expect(201);

      expect(response.body).toMatchObject({
        roomNumber: `201-${uniqueSuffix}`,
        categoryName,
        capacity: 2,
        basePrice: 12000,
        status: RoomStatus.ACTIVE,
      });

      createdRoomIds.push(response.body.id);
    });

    it('reutiliza el mismo tipo (misma categoría) para una segunda habitación', async () => {
      const response = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `202-${uniqueSuffix}`, categoryName, capacity: 2, basePrice: 12000 })
        .expect(201);

      createdRoomIds.push(response.body.id);

      const first = await em.findOne(Room, { id: createdRoomIds[0] }, { populate: ['category'] });
      const second = await em.findOne(Room, { id: createdRoomIds[1] }, { populate: ['category'] });
      expect(first!.category.id).toBe(second!.category.id);
    });

    it('rechaza con 409 si el número de habitación ya existe (CA2)', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `201-${uniqueSuffix}`, categoryName, capacity: 2, basePrice: 12000 })
        .expect(409);
    });

    it('rechaza con 400 si el precio no es positivo', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `203-${uniqueSuffix}`, categoryName, capacity: 2, basePrice: -100 })
        .expect(400);
    });

    it('rechaza con 400 si la capacidad no es positiva', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `203-${uniqueSuffix}`, categoryName, capacity: 0, basePrice: 12000 })
        .expect(400);
    });

    it('rechaza con 400 si falta el número de habitación', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .send({ categoryName, capacity: 2, basePrice: 12000 })
        .expect(400);
    });
  });

  describe('GET /rooms (CA1)', () => {
    it('devuelve el inventario con precios, capacidades y estados', async () => {
      const response = await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      const created = response.body.find((room: any) => room.id === createdRoomIds[0]);
      expect(created).toMatchObject({
        roomNumber: `201-${uniqueSuffix}`,
        categoryName,
        capacity: 2,
        basePrice: 12000,
        status: RoomStatus.ACTIVE,
      });
    });
  });

  describe('PATCH /rooms/:id (CA2, CA4)', () => {
    it('edita el número de habitación', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/rooms/${createdRoomIds[0]}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `201-B-${uniqueSuffix}` })
        .expect(200);

      expect(response.body.roomNumber).toBe(`201-B-${uniqueSuffix}`);
    });

    it('rechaza con 409 si el nuevo número ya lo usa otra habitación', async () => {
      await request(app.getHttpServer())
        .patch(`/rooms/${createdRoomIds[0]}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ roomNumber: `202-${uniqueSuffix}` })
        .expect(409);
    });

    it('cambia el precio base del tipo y se refleja en TODAS las habitaciones de ese tipo (CA4)', async () => {
      await request(app.getHttpServer())
        .patch(`/rooms/${createdRoomIds[0]}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ basePrice: 18000 })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      const sibling = response.body.find((room: any) => room.id === createdRoomIds[1]);
      expect(sibling.basePrice).toBe(18000);
    });

    it('deshabilita la habitación cambiando su estado a INACTIVE por PATCH', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/rooms/${createdRoomIds[1]}`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ status: RoomStatus.INACTIVE })
        .expect(200);

      expect(response.body.status).toBe(RoomStatus.INACTIVE);
    });

    it('responde 404 si la habitación no existe', async () => {
      await request(app.getHttpServer())
        .patch('/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', bearer(admin.accessToken))
        .send({ basePrice: 10000 })
        .expect(404);
    });
  });

  describe('DELETE /rooms/:id (CA3, baja segura)', () => {
    it('desactiva la habitación sin borrar el registro físico', async () => {
      await request(app.getHttpServer())
        .delete(`/rooms/${createdRoomIds[0]}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);
        
      em.clear();
      const room = await em.findOne(Room, { id: createdRoomIds[0] });
      expect(room).not.toBeNull();
      expect(room!.status).toBe(RoomStatus.INACTIVE);
    });

    it('es idempotente: una segunda baja no rompe', async () => {
      await request(app.getHttpServer())
        .delete(`/rooms/${createdRoomIds[0]}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);
    });

    it('responde 404 si la habitación no existe', async () => {
      await request(app.getHttpServer())
        .delete('/rooms/00000000-0000-0000-0000-000000000000')
        .set('Authorization', bearer(admin.accessToken))
        .expect(404);
    });
  });
});
