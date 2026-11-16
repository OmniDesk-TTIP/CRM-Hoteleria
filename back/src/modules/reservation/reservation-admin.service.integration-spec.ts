import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { EntityManager, MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { ReservationAdminService } from './reservation-admin.service';
import { SaveReservationDto } from './dto/saveReservation.dto';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';

describe('ReservationAdminService (integración)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let service: ReservationAdminService;

  const suffix = Date.now();
  const MISSING_ID = '00000000-0000-0000-0000-000000000000';
  let categoryId: string;
  let roomId: string;

  const payload = (
    overrides: Partial<SaveReservationDto> = {},
  ): SaveReservationDto => ({
    guestFullName: 'Juan Pérez',
    guestDni: '30111222',
    roomId,
    checkIn: '2099-11-10',
    checkOut: '2099-11-15',
    status: ReservationStatus.PENDING_PAYMENT,
    totalAmount: 100000,
    depositAmount: 30000,
    ...overrides,
  });

  const reservationsInRoom = () =>
    em.fork().count(Reservation, { room: roomId });

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

    em = app.get(MikroORM).em.fork();
    service = app.get(ReservationAdminService);

    const category = em.create(RoomCategory, {
      name: `Admin Int ${suffix}`,
      capacity: 2,
      basePrice: 20000,
    });
    const room = em.create(Room, {
      roomNumber: `ADM-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  afterAll(async () => {
    try {
      if (roomId) {
        await em.nativeDelete(Reservation, { room: roomId });
        await em.nativeDelete(Room, { id: roomId });
      }
      if (categoryId) {
        await em.nativeDelete(RoomCategory, { id: categoryId });
      }
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  it('rechaza con 400 un check-out que no es posterior al check-in, sin guardar nada', async () => {
    for (const checkOut of ['2099-11-10', '2099-11-09']) {
      await expect(
        service.create(payload({ checkIn: '2099-11-10', checkOut })),
      ).rejects.toThrow(BadRequestException);
    }
    expect(await reservationsInRoom()).toBe(0);
  });

  it('rechaza con 404 una habitación que no existe', async () => {
    await expect(
      service.create(payload({ roomId: MISSING_ID })),
    ).rejects.toThrow(NotFoundException);
  });

  it('rechaza con 404 editar una reserva que no existe', async () => {
    await expect(service.update(MISSING_ID, payload())).rejects.toThrow(
      NotFoundException,
    );
  });
});
