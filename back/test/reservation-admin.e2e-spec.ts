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
import { Reservation, ReservationStatus } from '../src/infrastructure/database/entities/Reservation.entity';

describe('Admin Reservations CRUD (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  let categoryId: string;
  let roomAId: string; // habitación usada por la mayoría de los tests
  let roomBId: string; // habitación aparte, para el test de disponibilidad
  let occupiedReservationId: string; // ya confirmada en roomB, para forzar el 409

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

    const uniqueSuffix = Date.now();
    const category = em.create(RoomCategory, { name: `Doble E2E-${uniqueSuffix}`, capacity: 2, basePrice: 20000 });
    const roomA = em.create(Room, { roomNumber: `A-${uniqueSuffix}`, category, status: RoomStatus.ACTIVE });
    const roomB = em.create(Room, { roomNumber: `B-${uniqueSuffix}`, category, status: RoomStatus.ACTIVE });

    const occupied = em.create(Reservation, {
      room: roomB,
      status: ReservationStatus.CONFIRMED,
      telegramUserId: '111222333',
      checkIn: new Date('2026-11-10'),
      checkOut: new Date('2026-11-15'),
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Reserva Bot Existente',
      guestDni: '20333444',
    });

    await em.flush();

    categoryId = category.id;
    roomAId = roomA.id;
    roomBId = roomB.id;
    occupiedReservationId = occupied.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Reservation, { room: { $in: [roomAId, roomBId] } });
      await em.nativeDelete(Room, { id: { $in: [roomAId, roomBId] } });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, { email: { $in: [admin.user.email, employee.user.email] } });
      if (app) await app.close();
    } catch (e) {
    }
  });

  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    guestFullName: 'Juan Pérez',
    guestDni: '30111222',
    roomId: roomAId,
    checkIn: '2026-12-01',
    checkOut: '2026-12-05',
    status: ReservationStatus.PENDING_PAYMENT,
    totalAmount: 80000,
    depositAmount: 24000,
    ...overrides,
  });

  describe('Autenticación y autorización', () => {
    it('GET /reservations sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/reservations').expect(401);
    });

    // El panel de reservas lo opera todo el personal: alcanza con estar autenticado. La
    // restricción por rol se reserva para la configuración del hotel (ver /rag y /support-hours).
    it('GET /reservations con un usuario Empleado responde 200 (ADMIN o EMPLOYEE pueden gestionar reservas)', async () => {
      await request(app.getHttpServer())
        .get('/reservations')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);
    });

    it('GET /rooms también está abierto a Empleado y a Administrador (lo usa el selector de habitaciones del alta manual)', async () => {
      await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);
    });

    it('GET /rooms sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/rooms').expect(401);
    });
  });

  describe('POST /reservations (CA2, CA3, CA4)', () => {
    it('crea una reserva manual y la marca con origin MANUAL', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(admin.accessToken))
        .send(validPayload())
        .expect(201);

      expect(response.body).toMatchObject({
        guestFullName: 'Juan Pérez',
        guestDni: '30111222',
        origin: 'MANUAL',
        room: { id: roomAId },
      });

      await em.nativeDelete(Reservation, { id: response.body.id });
    });

    it('responde 409 si la habitación ya está ocupada para esas fechas', async () => {
      await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(admin.accessToken))
        .send(
          validPayload({
            roomId: roomBId,
            checkIn: '2026-11-12',
            checkOut: '2026-11-13',
          }),
        )
        .expect(409);
    });

    it('responde 400 si faltan campos requeridos', async () => {
      await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(admin.accessToken))
        .send({ guestFullName: 'Sin el resto de los datos' })
        .expect(400);
    });
  });

  describe('GET /reservations (CA1)', () => {
    it('pagina y filtra por estado y rango de fechas', async () => {
      const response = await request(app.getHttpServer())
        .get('/reservations')
        .query({
          status: ReservationStatus.CONFIRMED,
          dateFrom: '2026-11-01',
          dateTo: '2026-11-30',
          page: 1,
          pageSize: 10,
          sortBy: 'checkIn',
          sortDir: 'asc',
        })
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      expect(response.body).toMatchObject({ page: 1, pageSize: 10 });
      expect(response.body.data.some((r: any) => r.id === occupiedReservationId)).toBe(true);
      expect(response.body.data.every((r: any) => r.status === ReservationStatus.CONFIRMED)).toBe(true);
    });
  });

  describe('PATCH /reservations/:id y DELETE /reservations/:id (CA3, CA5)', () => {
    let reservationId: string;

    beforeEach(async () => {
      const created = await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(admin.accessToken))
        .send(validPayload())
        .expect(201);

      reservationId = created.body.id;
    });

    afterEach(async () => {
      await em.nativeDelete(Reservation, { id: reservationId });
    });

    it('edita la reserva cuando la nueva habitación/fechas están libres', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/reservations/${reservationId}`)
        .set('Authorization', bearer(admin.accessToken))
        .send(validPayload({ status: ReservationStatus.CONFIRMED, guestFullName: 'Juan Pérez (editado)' }))
        .expect(200);

      expect(response.body).toMatchObject({ status: ReservationStatus.CONFIRMED, guestFullName: 'Juan Pérez (editado)' });
    });

    it('no choca contra sí misma al reeditar con las mismas fechas', async () => {
      await request(app.getHttpServer())
        .patch(`/reservations/${reservationId}`)
        .set('Authorization', bearer(admin.accessToken))
        .send(validPayload({ totalAmount: 90000 }))
        .expect(200);
    });

    it('DELETE cancela la reserva y libera la habitación de inmediato', async () => {
      await request(app.getHttpServer())
        .delete(`/reservations/${reservationId}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);

      em.clear();
      const cancelled = await em.findOne(Reservation, { id: reservationId });
      expect(cancelled?.status).toBe(ReservationStatus.CANCELLED);

      // La habitación quedó libre: se puede crear otra reserva pisando esas mismas fechas.
      await request(app.getHttpServer())
        .post('/reservations')
        .set('Authorization', bearer(admin.accessToken))
        .send(validPayload())
        .expect(201)
        .then(async (res) => em.nativeDelete(Reservation, { id: res.body.id }));
    });

    it('una doble confirmación de cancelación no rompe (idempotente)', async () => {
      await request(app.getHttpServer())
        .delete(`/reservations/${reservationId}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);

      await request(app.getHttpServer())
        .delete(`/reservations/${reservationId}`)
        .set('Authorization', bearer(admin.accessToken))
        .expect(204);
    });
  });

  it('DELETE /reservations/:id responde 404 si la reserva no existe', async () => {
    await request(app.getHttpServer())
      .delete('/reservations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', bearer(admin.accessToken))
      .expect(404);
  });
});
