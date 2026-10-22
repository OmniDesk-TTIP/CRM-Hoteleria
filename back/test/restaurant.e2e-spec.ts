import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from './../src/app.module';
import { RagService } from '../src/modules/rag/rag.service';
import { PaymentService } from '../src/modules/payment/payment.service';
import { RestaurantService } from '../src/modules/restaurant/restaurant.service';
import { RestaurantReservationService } from '../src/modules/restaurantReservation/restaurantReservation.service';
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
import { RestaurantSettings } from '../src/infrastructure/database/entities/RestaurantSettings.entity';
import { RestaurantMenuItem } from '../src/infrastructure/database/entities/RestaurantMenuItem.entity';
import { RestaurantPhoto } from '../src/infrastructure/database/entities/RestaurantPhoto.entity';
import {
  RestaurantReservation,
  RestaurantReservationStatus,
} from '../src/infrastructure/database/entities/RestaurantReservation.entity';
import { ChatMessage } from '../src/infrastructure/database/entities/ChatMessage.entity';
import { ChatSession } from '../src/infrastructure/database/entities/ChatSession.entity';

// PNG de 1x1: lo mínimo que pasa la detección por contenido.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Restaurante (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  const guestTelegramId = `tg-resto-${suffix}`;
  const sendMessage = jest.fn();
  let categoryId: string;
  let roomId: string;
  let reservationId: string;

  const settingsPayload = (overrides: Record<string, unknown> = {}) => ({
    status: 'ACTIVE',
    description: 'Cocina de autor',
    availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
    shifts: [
      { opensAt: '20:00', closesAt: '23:30' },
      { opensAt: '12:00', closesAt: '15:00' },
    ],
    maxPartySize: 6,
    ...overrides,
  });

  const server = () => app.getHttpServer();
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', bearer(admin.accessToken));

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

    // El restó es una sola fila y una sola galería: la suite arranca de cero en la base de test.
    await em.nativeDelete(RestaurantReservation, {});
    await em.nativeDelete(RestaurantSettings, {});
    await em.nativeDelete(RestaurantMenuItem, {});
    await em.nativeDelete(RestaurantPhoto, {});

    const category = em.create(RoomCategory, {
      name: `Cat resto ${suffix}`,
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
      telegramUserId: guestTelegramId,
      checkIn: new Date(2099, 0, 10, 12),
      checkOut: new Date(2099, 0, 20, 12),
      status: ReservationStatus.CONFIRMED,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: 'Ana Resto',
      guestDni: '30111222',
    });
    em.persist([category, room, reservation]);
    await em.flush();

    categoryId = category.id;
    roomId = room.id;
    reservationId = reservation.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(ChatMessage, { telegramUserId: guestTelegramId });
      await em.nativeDelete(ChatSession, { telegramUserId: guestTelegramId });
      await em.nativeDelete(RestaurantReservation, {});
      await em.nativeDelete(RestaurantSettings, {});
      await em.nativeDelete(RestaurantMenuItem, {});
      await em.nativeDelete(RestaurantPhoto, {});
      await em.nativeDelete(Reservation, { id: reservationId });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('información del restó (CA1)', () => {
    it('sin configurar devuelve los valores por defecto, deshabilitado', async () => {
      const response = await request(server())
        .get('/restaurant')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      expect(response.body).toMatchObject({
        configured: false,
        status: 'INACTIVE',
      });
    });

    it('solo el administrador la edita', async () => {
      await request(server())
        .put('/restaurant')
        .set('Authorization', bearer(employee.accessToken))
        .send(settingsPayload())
        .expect(403);
    });

    it('rechaza franjas superpuestas', async () => {
      const response = await asAdmin(request(server()).put('/restaurant'))
        .send(
          settingsPayload({
            shifts: [
              { opensAt: '12:00', closesAt: '16:00' },
              { opensAt: '15:00', closesAt: '18:00' },
            ],
          }),
        )
        .expect(400);
      expect(response.body.message).toContain('superponerse');
    });

    it('guarda y devuelve las franjas en orden', async () => {
      const response = await asAdmin(request(server()).put('/restaurant'))
        .send(settingsPayload())
        .expect(200);

      expect(response.body).toMatchObject({
        configured: true,
        status: 'ACTIVE',
        description: 'Cocina de autor',
        maxPartySize: 6,
        shifts: [
          { opensAt: '12:00', closesAt: '15:00' },
          { opensAt: '20:00', closesAt: '23:30' },
        ],
      });
    });
  });

  describe('carta (CA1/CA7)', () => {
    let milanesaId: string;
    let flanId: string;

    it('el administrador carga ítems; el empleado no', async () => {
      await request(server())
        .post('/restaurant/menu-items')
        .set('Authorization', bearer(employee.accessToken))
        .send({ name: 'Milanesa', category: 'Principales', price: 9000 })
        .expect(403);

      const milanesa = await asAdmin(
        request(server()).post('/restaurant/menu-items'),
      )
        .send({ name: 'Milanesa', category: 'Principales', price: 9000 })
        .expect(201);
      const flan = await asAdmin(
        request(server()).post('/restaurant/menu-items'),
      )
        .send({
          name: 'Flan',
          category: 'Postres',
          price: 3500,
          description: 'Con dulce de leche',
        })
        .expect(201);

      milanesaId = milanesa.body.id;
      flanId = flan.body.id;
      expect(flan.body).toMatchObject({ status: 'ACTIVE', price: 3500 });
    });

    it('no permite dos ítems con el mismo nombre', async () => {
      await asAdmin(request(server()).post('/restaurant/menu-items'))
        .send({ name: 'milanesa', category: 'Principales', price: 1 })
        .expect(409);
    });

    it('un ítem deshabilitado sale de la landing (CA7)', async () => {
      await asAdmin(request(server()).patch(`/restaurant/menu-items/${flanId}`))
        .send({ status: 'INACTIVE' })
        .expect(200);

      const response = await request(server())
        .get('/public/restaurant')
        .expect(200);
      const names = (
        response.body.menu as { items: { name: string }[] }[]
      ).flatMap((section) => section.items.map((item) => item.name));
      expect(names).toEqual(['Milanesa']);
    });

    it('el administrador elimina un ítem', async () => {
      await asAdmin(
        request(server()).delete(`/restaurant/menu-items/${flanId}`),
      ).expect(204);
      await asAdmin(
        request(server()).delete(`/restaurant/menu-items/${flanId}`),
      ).expect(404);
      expect(milanesaId).toBeDefined();
    });
  });

  describe('galería (CA6)', () => {
    const photoIds: string[] = [];

    it('sube fotos al final de la galería', async () => {
      for (let i = 0; i < 2; i++) {
        const response = await asAdmin(
          request(server()).post('/restaurant/photos'),
        )
          .attach('file', PNG_1X1, 'salon.png')
          .expect(201);
        photoIds.push(response.body.id);
        expect(response.body).toMatchObject({
          position: i,
          mimeType: 'image/png',
        });
      }
    });

    it('rechaza lo que no es una imagen aunque diga serlo', async () => {
      await asAdmin(request(server()).post('/restaurant/photos'))
        .attach('file', Buffer.from('<svg onload="alert(1)">'), {
          filename: 'falsa.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('reordena y la landing respeta el orden', async () => {
      const reversed = [...photoIds].reverse();
      await asAdmin(request(server()).put('/restaurant/photos/order'))
        .send({ ids: reversed })
        .expect(200);

      const response = await request(server())
        .get('/public/restaurant')
        .expect(200);
      expect(
        (response.body.photos as { id: string }[]).map((photo) => photo.id),
      ).toEqual(reversed);
    });

    it('rechaza un orden que no incluye todas las fotos', async () => {
      await asAdmin(request(server()).put('/restaurant/photos/order'))
        .send({ ids: [photoIds[0]] })
        .expect(400);
    });

    it('sirve la imagen sin autenticación', async () => {
      const response = await request(server())
        .get(`/public/restaurant/photos/${photoIds[0]}`)
        .expect(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(response.body as Buffer, PNG_1X1)).toBe(0);
    });

    it('elimina una foto', async () => {
      await asAdmin(
        request(server()).delete(`/restaurant/photos/${photoIds[1]}`),
      ).expect(204);
      await request(server())
        .get(`/public/restaurant/photos/${photoIds[1]}`)
        .expect(404);
    });
  });

  describe('Chamber (CA2/CA3/CA6)', () => {
    it('al huésped le pasa la carta y el link de fotos', async () => {
      const context = await app
        .get(RestaurantService)
        .getChatContext(guestTelegramId);

      expect(context.canBook).toBe(true);
      expect(context.block).toContain('- Milanesa | $9000');
      expect(context.block).toContain('FOTOS DEL ESPACIO');
    });

    it('al que no es huésped no le ofrece el restó', async () => {
      const context = await app
        .get(RestaurantService)
        .getChatContext(`tg-desconocido-${suffix}`);

      expect(context.canBook).toBe(false);
      expect(context.block).not.toContain('Milanesa');
    });
  });

  describe('pedidos de mesa (CA5)', () => {
    const NOW = new Date(Date.UTC(2099, 0, 12, 15, 0));
    let requestId: string;

    it('registra el pedido del huésped dentro de su estadía', async () => {
      const result = await app
        .get(RestaurantReservationService)
        .requestTable(
          guestTelegramId,
          { date: '14-01-2099', time: '21:00', partySize: 2, notes: 'Celíaco' },
          NOW,
        );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      requestId = result.request.id;
    });

    it('rechaza horarios fuera de las franjas y mesas muy grandes', async () => {
      const service = app.get(RestaurantReservationService);
      const outside = await service.requestTable(
        guestTelegramId,
        { date: '14-01-2099', time: '17:00', partySize: 2 },
        NOW,
      );
      const tooBig = await service.requestTable(
        guestTelegramId,
        { date: '14-01-2099', time: '21:00', partySize: 7 },
        NOW,
      );

      expect(outside).toMatchObject({ ok: false });
      expect(tooBig).toMatchObject({ ok: false });
    });

    it('queda visible en el panel para cualquier usuario', async () => {
      const response = await request(server())
        .get('/restaurant-reservations?status=PENDING')
        .set('Authorization', bearer(employee.accessToken))
        .expect(200);

      expect(response.body.items).toEqual([
        expect.objectContaining({
          id: requestId,
          guestFullName: 'Ana Resto',
          requestedDate: '2099-01-14',
          requestedTime: '21:00',
          partySize: 2,
          notes: 'Celíaco',
        }),
      ]);
    });

    it('recepción lo confirma y se le avisa al huésped', async () => {
      sendMessage.mockClear();
      const response = await request(server())
        .patch(`/restaurant-reservations/${requestId}/status`)
        .set('Authorization', bearer(employee.accessToken))
        .send({ status: 'CONFIRMED' })
        .expect(200);

      expect(response.body.status).toBe(RestaurantReservationStatus.CONFIRMED);
      expect(sendMessage).toHaveBeenCalledWith(
        guestTelegramId,
        expect.stringContaining('quedó confirmada'),
      );

      await request(server())
        .patch(`/restaurant-reservations/${requestId}/status`)
        .set('Authorization', bearer(employee.accessToken))
        .send({ status: 'REJECTED' })
        .expect(400);
    });
  });

  it('con el restó deshabilitado la landing no publica nada y Chamber no reserva (CA7)', async () => {
    await asAdmin(request(server()).put('/restaurant'))
      .send(settingsPayload({ status: 'INACTIVE' }))
      .expect(200);

    const response = await request(server())
      .get('/public/restaurant')
      .expect(200);
    expect(response.body).toMatchObject({
      available: false,
      menu: [],
      photos: [],
    });

    const context = await app
      .get(RestaurantService)
      .getChatContext(guestTelegramId);
    expect(context.canBook).toBe(false);
    expect(context.block).not.toContain('Milanesa');
  });
});
