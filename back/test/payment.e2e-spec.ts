import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { getBotToken } from 'nestjs-telegraf';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { Room, RoomStatus } from '../src/infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../src/infrastructure/database/entities/RoomCategory.entity';
import { Reservation, ReservationStatus } from '../src/infrastructure/database/entities/Reservation.entity';

describe('Payment Webhook (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let paymentServiceMock: any;
  let reservationId: string;
  let seededCategoryId: string;
  let seededRoomId: string;

  beforeAll(async () => {
    paymentServiceMock = {
      createPreference: jest.fn(),
      getPayment: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      notifyPaymentApproved: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(RagService)
      .useValue({ askQuestion: jest.fn() })
      .overrideProvider(PaymentService)
      .useValue(paymentServiceMock)
      .overrideProvider(getBotToken())
      .useValue({ launch: jest.fn(), stop: jest.fn(), on: jest.fn(), start: jest.fn(), use: jest.fn(), telegram: { sendMessage: jest.fn() } })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const orm = app.get(MikroORM);
    em = orm.em.fork();

    const uniqueSuffix = Date.now();
    const category = em.create(RoomCategory, { name: `Suite Pago E2E-${uniqueSuffix}`, capacity: 2, basePrice: 15000 });
    const room = em.create(Room, { roomNumber: `202-${uniqueSuffix}`, category, status: RoomStatus.ACTIVE });

    const reservation = em.create(Reservation, {
      room,
      status: ReservationStatus.PENDING_PAYMENT,
      telegramUserId: '555444333',
      checkIn: new Date(2026, 10, 1),
      checkOut: new Date(2026, 10, 5),
      totalAmount: 60000,
      depositAmount: 18000,
      guestFullName: 'Juan Pérez',
      guestDni: '30111222',
    });

    await em.flush();
    reservationId = reservation.id;
    seededCategoryId = category.id;
    seededRoomId = room.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Reservation, { id: reservationId });
      await em.nativeDelete(Room, { id: seededRoomId });
      await em.nativeDelete(RoomCategory, { id: seededCategoryId });

      if (app) await app.close();
    } catch (e) {
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /payment/webhook responde sin procesar si la firma no es válida', async () => {
    paymentServiceMock.verifyWebhookSignature.mockReturnValue(false);

    await request(app.getHttpServer())
      .post('/payment/webhook')
      .set('x-signature', 'ts=1,v1=invalida')
      .set('x-request-id', 'req-e2e')
      .send({ type: 'payment', data: { id: 'pay-e2e' } })
      .expect(401);

    expect(paymentServiceMock.getPayment).not.toHaveBeenCalled();
  });

  it('POST /payment/webhook confirma la reserva cuando el pago está aprobado', async () => {
    paymentServiceMock.verifyWebhookSignature.mockReturnValue(true);
    paymentServiceMock.getPayment.mockResolvedValue({ id: 987654, status: 'approved', external_reference: reservationId });

    await request(app.getHttpServer())
      .post('/payment/webhook')
      .set('x-signature', 'ts=1,v1=valida')
      .set('x-request-id', 'req-e2e')
      .send({ type: 'payment', data: { id: 'pay-e2e' } })
      .expect(200)
      .expect({ received: true });

    em.clear();
    const reservation = await em.findOne(Reservation, { id: reservationId });
    expect(reservation?.status).toBe(ReservationStatus.CONFIRMED);
    expect(reservation?.mpPaymentId).toBe('987654');
    expect(paymentServiceMock.notifyPaymentApproved).toHaveBeenCalledWith('555444333', reservation?.checkIn, reservation?.checkOut);
  });

  it('GET /payment/:reservationId/summary devuelve los datos de la reserva', async () => {
    const response = await request(app.getHttpServer()).get(`/payment/${reservationId}/summary`).expect(200);

    expect(response.body).toMatchObject({
      id: reservationId,
      guestFullName: 'Juan Pérez',
      totalAmount: 60000,
      depositAmount: 18000,
    });
  });

  it('GET /payment/:reservationId/summary devuelve 404 si la reserva no existe', async () => {
    await request(app.getHttpServer()).get('/payment/00000000-0000-0000-0000-000000000000/summary').expect(404);
  });
});
