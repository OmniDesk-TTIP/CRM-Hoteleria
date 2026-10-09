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
import {
  User,
  UserRole,
} from '../src/infrastructure/database/entities/User.entity';
import {
  Room,
  RoomStatus,
} from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationStatus,
} from '../src/infrastructure/database/entities/Reservation.entity';
import { SpaService } from '../src/infrastructure/database/entities/SpaService.entity';
import { ChatMessage } from '../src/infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../src/infrastructure/database/entities/ChatSession.entity';
import {
  SpaReservation,
  SpaReservationStatus,
} from '../src/infrastructure/database/entities/SpaReservation.entity';

describe('Solicitudes de servicios en el panel (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  const requestIds: string[] = [];
  let reservationId: string;
  let spaServiceId: string;
  let roomId: string;
  let categoryId: string;

  const seedRequest = async (
    overrides: Partial<SpaReservation> = {},
  ): Promise<SpaReservation> => {
    const entity = em.create(SpaReservation, {
      telegramUserId: `tg-${suffix}`,
      roomReservation: em.getReference(Reservation, reservationId),
      spaService: em.getReference(SpaService, spaServiceId),
      serviceName: `Masaje E2E ${suffix}`,
      guestFullName: 'Ana E2E',
      requestedDate: '2099-01-15',
      requestedTime: '15:00',
      ...overrides,
    });
    em.persist(entity);
    await em.flush();
    requestIds.push(entity.id);
    return entity;
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
        telegram: { sendMessage: jest.fn() },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);

    const category = em.create(RoomCategory, {
      name: `Cat spa-reservation ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `SR-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    const reservation = em.create(Reservation, {
      room,
      telegramUserId: `tg-${suffix}`,
      checkIn: new Date(2099, 0, 10),
      checkOut: new Date(2099, 0, 20),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana E2E',
      guestDni: '30111222',
    });
    const spa = em.create(SpaService, {
      name: `Masaje E2E ${suffix}`,
      description: 'Masaje',
      durationMinutes: 60,
      price: 15000,
      availableWeekdays: [1, 2, 3, 4, 5],
      opensAt: '10:00',
      closesAt: '20:00',
    });
    em.persist([category, room, reservation, spa]);
    await em.flush();

    categoryId = category.id;
    roomId = room.id;
    reservationId = reservation.id;
    spaServiceId = spa.id;
  });

  afterAll(async () => {
    try {
      // al resolver un turno el service avisa al huésped y eso crea la sesión y el mensaje del chat
      await em.nativeDelete(ChatMessage, { telegramUserId: `tg-${suffix}` });
      await em.nativeDelete(ChatSession, { telegramUserId: `tg-${suffix}` });
      if (requestIds.length > 0) {
        await em.nativeDelete(SpaReservation, { id: { $in: requestIds } });
      }
      await em.nativeDelete(Reservation, { id: reservationId });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(SpaService, { id: spaServiceId });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('GET /spa-reservations (CA4)', () => {
    it('sin token responde 401', async () => {
      await request(app.getHttpServer()).get('/spa-reservations').expect(401);
    });

    it('lista las solicitudes para cualquier usuario del panel, con paginación', async () => {
      const created = await seedRequest();

      const response = await request(app.getHttpServer())
        .get('/spa-reservations?pageSize=100')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      expect(response.body).toMatchObject({ page: 1, pageSize: 100 });
      const row = (response.body.items as Array<{ id: string }>).find(
        (item) => item.id === created.id,
      );
      expect(row).toMatchObject({
        status: SpaReservationStatus.PENDING,
        serviceName: `Masaje E2E ${suffix}`,
        guestFullName: 'Ana E2E',
        requestedDate: '2099-01-15',
        requestedTime: '15:00',
      });
    });

    it('filtra por estado', async () => {
      const confirmed = await seedRequest({
        status: SpaReservationStatus.CONFIRMED,
      });

      const response = await request(app.getHttpServer())
        .get('/spa-reservations?status=CONFIRMED&pageSize=100')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      const items = response.body.items as Array<{
        id: string;
        status: string;
      }>;
      expect(items.map((item) => item.id)).toContain(confirmed.id);
      expect(items.every((item) => item.status === 'CONFIRMED')).toBe(true);
    });

    it('responde 400 con un estado inválido', async () => {
      await request(app.getHttpServer())
        .get('/spa-reservations?status=NOPE')
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);
    });
  });

  describe('PATCH /spa-reservations/:id/status', () => {
    it('confirma una solicitud pendiente', async () => {
      const created = await seedRequest();

      const response = await request(app.getHttpServer())
        .patch(`/spa-reservations/${created.id}/status`)
        .set('Authorization', bearer(employee.accessToken))
        .send({ status: 'CONFIRMED' })
        .expect(200);

      expect(response.body.status).toBe(SpaReservationStatus.CONFIRMED);
    });

    it('responde 400 si se intenta volver a PENDING', async () => {
      const created = await seedRequest();

      await request(app.getHttpServer())
        .patch(`/spa-reservations/${created.id}/status`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ status: 'PENDING' })
        .expect(400);
    });

    it('responde 404 si no existe', async () => {
      await request(app.getHttpServer())
        .patch('/spa-reservations/00000000-0000-0000-0000-000000000000/status')
        .set('Authorization', bearer(admin.accessToken))
        .send({ status: 'CONFIRMED' })
        .expect(404);
    });
  });
});
