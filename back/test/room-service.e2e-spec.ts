import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { ChatMessage } from '../src/infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../src/infrastructure/database/entities/ChatSession.entity';
import {
  RoomServiceOrder,
  RoomServiceOrderStatus,
  RoomServicePaymentStatus,
} from '../src/infrastructure/database/entities/RoomServiceOrder.entity';

describe('Pedidos de room service en el panel (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  const telegramUserId = `tg-rs-e2e-${suffix}`;
  const getPayment = jest.fn();
  const verifyWebhookSignature = jest.fn();
  const sendMessage = jest.fn();

  let reservationId: string;
  let roomId: string;
  let categoryId: string;

  const seedOrder = async (
    overrides: Partial<RoomServiceOrder> = {},
  ): Promise<RoomServiceOrder> => {
    const entity = em.create(RoomServiceOrder, {
      status: RoomServiceOrderStatus.RECEIVED,
      telegramUserId,
      roomReservation: em.getReference(Reservation, reservationId),
      roomNumber: `RS-${suffix}`,
      guestFullName: 'Ana E2E',
      items: [
        {
          menuItemId: '00000000-0000-4000-8000-000000000001',
          name: 'Café',
          unitPrice: 1500,
          quantity: 2,
          notes: null,
        },
      ],
      total: 3000,
      confirmedAt: new Date(),
      ...overrides,
    });
    em.persist(entity);
    await em.flush();
    return entity;
  };

  const rowById = (id: string) =>
    em.fork().findOneOrFail(RoomServiceOrder, { id });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ ingestDocument: jest.fn(), askQuestion: jest.fn() })
      .overrideProvider(PaymentService)
      .useValue({
        createPreference: jest.fn(),
        createRoomServicePreference: jest.fn(),
        getPayment,
        verifyWebhookSignature,
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
    app.use(cookieParser());
    app.useGlobalPipes(createValidationPipe());
    await app.init();

    em = app.get(MikroORM).em.fork();
    admin = await seedUser(app, em, UserRole.ADMIN);
    employee = await seedUser(app, em, UserRole.EMPLOYEE);

    const category = em.create(RoomCategory, {
      name: `Cat room-service e2e ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `RS-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    const reservation = em.create(Reservation, {
      room,
      telegramUserId,
      checkIn: new Date(2099, 0, 10, 12),
      checkOut: new Date(2099, 0, 20, 12),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana E2E',
      guestDni: '30111222',
    });
    em.persist([category, room, reservation]);
    await em.flush();

    categoryId = category.id;
    roomId = room.id;
    reservationId = reservation.id;
  });

  beforeEach(() => {
    getPayment.mockReset();
    verifyWebhookSignature.mockReset();
    sendMessage.mockReset();
    sendMessage.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(ChatMessage, { telegramUserId });
      await em.nativeDelete(ChatSession, { telegramUserId });
      await em.nativeDelete(RoomServiceOrder, { telegramUserId });
      await em.nativeDelete(Reservation, { id: reservationId });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, {
        id: { $in: [admin.user.id, employee.user.id] },
      });
    } finally {
      if (app) await app.close();
    }
  });

  describe('acceso (CA10)', () => {
    it('sin token responde 401', async () => {
      await request(app.getHttpServer())
        .get('/room-service-orders')
        .expect(401);
    });

    it('un empleado no ve ni gestiona los pedidos (403)', async () => {
      const order = await seedOrder();

      await request(app.getHttpServer())
        .get('/room-service-orders')
        .set('Authorization', bearer(employee.accessToken))
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/room-service-orders/${order.id}/status`)
        .set('Authorization', bearer(employee.accessToken))
        .send({ status: RoomServiceOrderStatus.IN_PREPARATION })
        .expect(403);

      expect((await rowById(order.id)).status).toBe(
        RoomServiceOrderStatus.RECEIVED,
      );
    });
  });

  describe('listado y estados (CA6/CA7)', () => {
    it('el admin lista los pedidos confirmados, sin los borradores', async () => {
      const order = await seedOrder();
      const draft = await seedOrder({
        status: RoomServiceOrderStatus.PENDING_CONFIRMATION,
        confirmedAt: null,
      });

      const res = await request(app.getHttpServer())
        .get('/room-service-orders?pageSize=100')
        .set('Authorization', bearer(admin.accessToken))
        .expect(200);

      const ids = (res.body.items as { id: string }[]).map((item) => item.id);
      expect(ids).toContain(order.id);
      expect(ids).not.toContain(draft.id);
      expect(
        res.body.items.find((item: { id: string }) => item.id === order.id),
      ).toEqual(
        expect.objectContaining({
          guestFullName: 'Ana E2E',
          roomNumber: `RS-${suffix}`,
          total: 3000,
          status: RoomServiceOrderStatus.RECEIVED,
          paymentStatus: RoomServicePaymentStatus.PENDING,
        }),
      );
    });

    it('filtrar por el estado borrador es inválido (400)', async () => {
      await request(app.getHttpServer())
        .get('/room-service-orders?status=PENDING_CONFIRMATION')
        .set('Authorization', bearer(admin.accessToken))
        .expect(400);
    });

    it('el admin cambia el estado y el huésped recibe el aviso', async () => {
      const order = await seedOrder();

      const res = await request(app.getHttpServer())
        .patch(`/room-service-orders/${order.id}/status`)
        .set('Authorization', bearer(admin.accessToken))
        .send({ status: RoomServiceOrderStatus.IN_PREPARATION })
        .expect(200);

      expect(res.body.status).toBe(RoomServiceOrderStatus.IN_PREPARATION);
      expect(sendMessage).toHaveBeenCalledWith(
        telegramUserId,
        expect.stringContaining('en preparación'),
      );
    });

    it('rechaza una transición inválida (400), un estado desconocido (400) y un id inexistente (404)', async () => {
      const order = await seedOrder();
      const server = app.getHttpServer();
      const auth = bearer(admin.accessToken);

      await request(server)
        .patch(`/room-service-orders/${order.id}/status`)
        .set('Authorization', auth)
        .send({ status: RoomServiceOrderStatus.DELIVERED })
        .expect(400);
      await request(server)
        .patch(`/room-service-orders/${order.id}/status`)
        .set('Authorization', auth)
        .send({ status: RoomServiceOrderStatus.RECEIVED })
        .expect(400);
      await request(server)
        .patch(
          '/room-service-orders/00000000-0000-4000-8000-000000000000/status',
        )
        .set('Authorization', auth)
        .send({ status: RoomServiceOrderStatus.IN_PREPARATION })
        .expect(404);
    });
  });

  describe('pago (CA9)', () => {
    it('el webhook de un pago aprobado marca el pedido como pagado (sin autenticación)', async () => {
      const order = await seedOrder();
      getPayment.mockResolvedValue({
        id: 7001,
        status: 'approved',
        external_reference: order.id,
      });

      await request(app.getHttpServer())
        .post('/room-service-payments/webhook')
        .send({ type: 'payment', data: { id: '7001' } })
        .expect(200);

      expect((await rowById(order.id)).paymentStatus).toBe(
        RoomServicePaymentStatus.PAID,
      );
    });

    it('rechaza con 401 un webhook con la firma inválida', async () => {
      verifyWebhookSignature.mockReturnValue(false);

      await request(app.getHttpServer())
        .post('/room-service-payments/webhook')
        .set('x-signature', 'ts=1,v1=falsa')
        .send({ type: 'payment', data: { id: '7002' } })
        .expect(401);

      expect(getPayment).not.toHaveBeenCalled();
    });

    it('al volver del checkout confirma el pago y redirige al front', async () => {
      const order = await seedOrder();
      getPayment.mockResolvedValue({
        id: 7003,
        status: 'approved',
        external_reference: order.id,
      });
      const frontendBaseUrl = app
        .get(ConfigService)
        .getOrThrow<string>('FRONTEND_BASE_URL');

      await request(app.getHttpServer())
        .get('/room-service-payments/success?payment_id=7003')
        .expect(302)
        .expect('Location', `${frontendBaseUrl}/payment/success`);

      expect((await rowById(order.id)).paymentStatus).toBe(
        RoomServicePaymentStatus.PAID,
      );
    });
  });

  describe('carta para la landing (CA2)', () => {
    it('es pública', async () => {
      const res = await request(app.getHttpServer())
        .get('/public/room-service')
        .expect(200);

      expect(res.body).toEqual(
        expect.objectContaining({
          available: expect.any(Boolean),
          menu: expect.any(Array),
        }),
      );
    });
  });
});
