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
import { RoomCategoryPhoto } from '../src/infrastructure/database/entities/RoomCategoryPhoto.entity';

// PNG de 1x1: lo mínimo que pasa la detección por contenido.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Fotos por tipo de habitación (e2e)', () => {
  let app: INestApplication;
  let em: EntityManager;
  let admin: Awaited<ReturnType<typeof seedUser>>;
  let employee: Awaited<ReturnType<typeof seedUser>>;

  const suffix = Date.now();
  const categoryName = `Suite Fotos-${suffix}`;
  const otherCategoryName = `Doble Fotos-${suffix}`;
  let categoryId: string;
  let otherCategoryId: string;
  const photoIds: string[] = [];

  const server = () => app.getHttpServer();
  const photosPath = (id = categoryId) => `/rooms/categories/${id}/photos`;
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', bearer(admin.accessToken));
  const publicPhotoIds = async () => {
    const response = await request(server()).get('/public/rooms').expect(200);
    const room = (
      response.body as { name: string; photos: { id: string }[] }[]
    ).find((r) => r.name === categoryName);
    return room!.photos.map((photo) => photo.id);
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
      name: categoryName,
      capacity: 4,
      basePrice: 20000,
    });
    const other = em.create(RoomCategory, {
      name: otherCategoryName,
      capacity: 2,
      basePrice: 12000,
    });
    em.create(Room, {
      roomNumber: `FOT-${suffix}-1`,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.create(Room, {
      roomNumber: `FOT-${suffix}-2`,
      category: other,
      status: RoomStatus.ACTIVE,
    });
    await em.flush();
    categoryId = category.id;
    otherCategoryId = other.id;
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Room, { roomNumber: { $like: `FOT-${suffix}-%` } });
      // La FK es on delete cascade: borrar el tipo se lleva sus fotos.
      await em.nativeDelete(RoomCategory, {
        id: { $in: [categoryId, otherCategoryId] },
      });
      await em.nativeDelete(User, {
        email: { $in: [admin.user.email, employee.user.email] },
      });
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  it('un empleado puede ver la galería pero no subir fotos', async () => {
    await request(server())
      .get(photosPath())
      .set('Authorization', bearer(employee.accessToken))
      .expect(200);
    await request(server())
      .post(photosPath())
      .set('Authorization', bearer(employee.accessToken))
      .attach('file', PNG_1X1, 'suite.png')
      .expect(403);
  });

  it('sube fotos al final de la galería del tipo', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await asAdmin(request(server()).post(photosPath()))
        .attach('file', PNG_1X1, 'suite.png')
        .expect(201);
      photoIds.push(response.body.id);
      expect(response.body).toMatchObject({
        position: i,
        mimeType: 'image/png',
        url: `/public/rooms/photos/${response.body.id}`,
      });
    }
  });

  it('rechaza lo que no es una imagen aunque diga serlo', async () => {
    await asAdmin(request(server()).post(photosPath()))
      .attach('file', Buffer.from('<svg onload="alert(1)">'), {
        filename: 'falsa.png',
        contentType: 'image/png',
      })
      .expect(400);
  });

  it('responde 404 si el tipo de habitación no existe', async () => {
    await asAdmin(
      request(server()).post(
        photosPath('00000000-0000-0000-0000-000000000000'),
      ),
    )
      .attach('file', PNG_1X1, 'suite.png')
      .expect(404);
  });

  it('la landing recibe las fotos de cada tipo, sin mezclarlas', async () => {
    expect(await publicPhotoIds()).toEqual(photoIds);

    const response = await request(server()).get('/public/rooms').expect(200);
    const other = (response.body as { name: string; photos: unknown[] }[]).find(
      (r) => r.name === otherCategoryName,
    );
    expect(other!.photos).toEqual([]);
  });

  it('reordena y la landing respeta el orden', async () => {
    const reversed = [...photoIds].reverse();
    await asAdmin(request(server()).put(`${photosPath()}/order`))
      .send({ ids: reversed })
      .expect(200);

    expect(await publicPhotoIds()).toEqual(reversed);
  });

  it('rechaza un orden que no incluye todas las fotos del tipo', async () => {
    await asAdmin(request(server()).put(`${photosPath()}/order`))
      .send({ ids: [photoIds[0]] })
      .expect(400);
  });

  it('sirve la imagen sin autenticación', async () => {
    const response = await request(server())
      .get(`/public/rooms/photos/${photoIds[0]}`)
      .expect(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toContain('immutable');
    expect(Buffer.compare(response.body as Buffer, PNG_1X1)).toBe(0);
  });

  it('no borra una foto desde otro tipo de habitación', async () => {
    await asAdmin(
      request(server()).delete(`${photosPath(otherCategoryId)}/${photoIds[1]}`),
    ).expect(404);
  });

  it('elimina una foto', async () => {
    await asAdmin(
      request(server()).delete(`${photosPath()}/${photoIds[1]}`),
    ).expect(204);
    await request(server())
      .get(`/public/rooms/photos/${photoIds[1]}`)
      .expect(404);
    expect(await em.fork().count(RoomCategoryPhoto, { id: photoIds[1] })).toBe(
      0,
    );
  });
});
