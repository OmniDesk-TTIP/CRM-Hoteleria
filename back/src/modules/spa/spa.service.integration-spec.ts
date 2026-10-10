import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM, EntityManager } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { SpaService } from './spa.service';
import { CreateSpaServiceDto } from './dto/createSpaService.dto';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { RoomCategory } from '../../infrastructure/database/entities/RoomCategory.entity';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  SpaService as SpaServiceEntity,
  SpaServiceStatus,
} from '../../infrastructure/database/entities/SpaService.entity';

describe('SpaService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let em: EntityManager;
  let service: SpaService;

  const suffix = Date.now();
  let seq = 0;
  const next = () => `${suffix}-${++seq}`;

  const NOW = new Date(Date.UTC(2099, 2, 15, 15, 0));
  const GUEST_NAME = 'Ana E2E';

  let categoryId: string;
  let roomId: string;
  const serviceIds: string[] = [];
  const reservationIds: string[] = [];

  const buildPayload = (
    overrides: Partial<CreateSpaServiceDto> = {},
  ): CreateSpaServiceDto => ({
    name: `Masaje ${next()}`,
    description: 'Masaje de 60 minutos',
    durationMinutes: 60,
    price: 15000,
    availableWeekdays: [1, 2, 3, 4, 5],
    opensAt: '10:00',
    closesAt: '20:00',
    ...overrides,
  });

  const createSpa = async (overrides: Partial<CreateSpaServiceDto> = {}) => {
    const spa = await service.create(buildPayload(overrides));
    serviceIds.push(spa.id);
    return spa;
  };

  const rowOf = (id: string) =>
    em.fork().findOneOrFail(SpaServiceEntity, { id });

  const countByName = (name: string) =>
    em.fork().count(SpaServiceEntity, { name });

  type Day = [year: number, month: number, day: number];

  const seedReservation = async (
    telegramUserId: string,
    checkIn: Day,
    checkOut: Day,
    status = ReservationStatus.CONFIRMED,
  ) => {
    const day = ([y, m, d]: Day) => new Date(y, m - 1, d, 12); // mediodía local
    const reservation = em.create(Reservation, {
      room: em.getReference(Room, roomId),
      telegramUserId,
      checkIn: day(checkIn),
      checkOut: day(checkOut),
      status,
      totalAmount: 100000,
      depositAmount: 30000,
      guestFullName: GUEST_NAME,
      guestDni: '30111222',
    });
    em.persist(reservation);
    await em.flush();
    reservationIds.push(reservation.id);
    return reservation;
  };

  const newGuest = () => `tg-spa-${next()}`;

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
    await app.init();

    orm = app.get(MikroORM);
    em = orm.em.fork();
    service = app.get(SpaService);

    const category = em.create(RoomCategory, {
      name: `Cat spa ${suffix}`,
      capacity: 2,
      basePrice: 10000,
    });
    const room = em.create(Room, {
      roomNumber: `SPA-SVC-${suffix}`,
      category,
      status: RoomStatus.ACTIVE,
    });
    em.persist([category, room]);
    await em.flush();
    categoryId = category.id;
    roomId = room.id;
  });

  beforeEach(() => {
    orm.em.clear();
  });

  afterAll(async () => {
    try {
      await em.nativeDelete(Reservation, { id: { $in: reservationIds } });
      await em.nativeDelete(SpaServiceEntity, { id: { $in: serviceIds } });
      await em.nativeDelete(Room, { id: roomId });
      await em.nativeDelete(RoomCategory, { id: categoryId });
    } catch {
      // no-op: limpieza best-effort
    }
    if (app) await app.close();
  });

  describe('create (CA1)', () => {
    it('crea el servicio ACTIVE y lo persiste', async () => {
      const spa = await createSpa({ name: `Circuito ${next()}` });

      expect(spa.status).toBe(SpaServiceStatus.ACTIVE);
      const row = await rowOf(spa.id);
      expect(row).toMatchObject({
        name: spa.name,
        description: 'Masaje de 60 minutos',
        durationMinutes: 60,
        capacity: 1,
        status: SpaServiceStatus.ACTIVE,
        availableWeekdays: [1, 2, 3, 4, 5],
        opensAt: '10:00',
        closesAt: '20:00',
      });
      expect(Number(row.price)).toBe(15000);
    });

    it('guarda la capacidad indicada', async () => {
      const spa = await createSpa({ capacity: 3 });

      expect((await rowOf(spa.id)).capacity).toBe(3);
    });

    it('rechaza un nombre repetido sin distinguir mayúsculas', async () => {
      const spa = await createSpa();

      await expect(
        service.create(buildPayload({ name: spa.name.toUpperCase() })),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      [
        'no tiene días disponibles',
        { availableWeekdays: [] },
        /al menos un día/,
      ],
      ['repite días', { availableWeekdays: [1, 1] }, /no pueden repetirse/],
      [
        'cierra antes de abrir',
        { opensAt: '18:00', closesAt: '10:00' },
        /posterior/,
      ],
      ['tiene capacidad 0', { capacity: 0 }, /capacidad/],
      [
        'dura más que la franja',
        { durationMinutes: 120, opensAt: '10:00', closesAt: '11:00' },
        /no entra/,
      ],
    ])(
      'rechaza un horario inconsistente: %s',
      async (_label, overrides, message) => {
        const payload = buildPayload(overrides);

        await expect(service.create(payload)).rejects.toThrow(
          BadRequestException,
        );
        await expect(service.create(payload)).rejects.toThrow(message);
        expect(await countByName(payload.name)).toBe(0);
      },
    );
  });

  describe('update (CA1)', () => {
    it('aplica solo los campos informados y los persiste', async () => {
      const spa = await createSpa();

      const updated = await service.update(spa.id, {
        price: 18000,
        capacity: 4,
        opensAt: '11:00',
      });

      expect(updated).toMatchObject({
        price: 18000,
        capacity: 4,
        opensAt: '11:00',
      });
      const row = await rowOf(spa.id);
      expect(Number(row.price)).toBe(18000);
      expect(row).toMatchObject({
        capacity: 4,
        opensAt: '11:00',
        closesAt: '20:00',
        name: spa.name,
      });
    });

    it('rechaza renombrar a un nombre que ya usa otro servicio', async () => {
      const first = await createSpa();
      const second = await createSpa();

      await expect(
        service.update(second.id, { name: first.name }),
      ).rejects.toThrow(ConflictException);
    });

    it('permite cambiar solo las mayúsculas del propio nombre', async () => {
      const spa = await createSpa();

      const updated = await service.update(spa.id, {
        name: spa.name.toUpperCase(),
      });

      expect(updated.name).toBe(spa.name.toUpperCase());
    });

    it('rechaza un cambio que deja el horario inconsistente y no lo persiste', async () => {
      const spa = await createSpa();

      await expect(
        service.update(spa.id, { durationMinutes: 700 }),
      ).rejects.toThrow(BadRequestException);
      expect((await rowOf(spa.id)).durationMinutes).toBe(60);
    });

    it('lanza NotFound si no existe', async () => {
      await expect(
        service.update('00000000-0000-0000-0000-000000000000', { price: 1 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (CA7)', () => {
    it('deshabilita sin borrar, es idempotente y se puede reactivar', async () => {
      const spa = await createSpa();

      await service.remove(spa.id);
      await expect(service.remove(spa.id)).resolves.toBeUndefined();
      expect((await rowOf(spa.id)).status).toBe(SpaServiceStatus.INACTIVE);

      await service.update(spa.id, { status: SpaServiceStatus.ACTIVE });
      expect((await rowOf(spa.id)).status).toBe(SpaServiceStatus.ACTIVE);
    });

    it('lanza NotFound si no existe', async () => {
      await expect(
        service.remove('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findEligibleStay (CA2)', () => {
    const iso = ([y, m, d]: Day) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    it.each([
      ['futura', [2099, 4, 1], [2099, 4, 5]],
      ['en curso', [2099, 3, 10], [2099, 3, 20]],
      ['con salida hoy', [2099, 3, 10], [2099, 3, 15]],
    ] as [string, Day, Day][])(
      'devuelve la estadía de una reserva confirmada %s',
      async (_label, checkIn, checkOut) => {
        const guest = newGuest();
        const reservation = await seedReservation(guest, checkIn, checkOut);

        await expect(service.findEligibleStay(guest, NOW)).resolves.toEqual({
          reservationId: reservation.id,
          guestFullName: GUEST_NAME,
          stay: { checkIn: iso(checkIn), checkOut: iso(checkOut) },
          today: '2099-03-15',
        });
      },
    );

    it('devuelve null si el huésped no tiene reservas', async () => {
      await expect(
        service.findEligibleStay(newGuest(), NOW),
      ).resolves.toBeNull();
    });

    it.each([
      ['la salida fue ayer', [2099, 3, 14], ReservationStatus.CONFIRMED],
      [
        'está pendiente de pago',
        [2099, 3, 20],
        ReservationStatus.PENDING_PAYMENT,
      ],
      ['está cancelada', [2099, 3, 20], ReservationStatus.CANCELLED],
    ] as [string, Day, ReservationStatus][])(
      'devuelve null si la reserva %s',
      async (_label, checkOut, status) => {
        const guest = newGuest();
        await seedReservation(guest, [2099, 3, 10], checkOut, status);

        await expect(service.findEligibleStay(guest, NOW)).resolves.toBeNull();
      },
    );

    it('con varias vigentes elige la que termina primero (la estadía en curso)', async () => {
      const guest = newGuest();
      await seedReservation(guest, [2099, 4, 1], [2099, 4, 5]);
      const current = await seedReservation(
        guest,
        [2099, 3, 10],
        [2099, 3, 20],
      );

      const stay = await service.findEligibleStay(guest, NOW);

      expect(stay?.reservationId).toBe(current.id);
    });

    it('evalúa "hoy" en la zona horaria del hotel y no en UTC', async () => {
      const guest = newGuest();
      await seedReservation(guest, [2099, 3, 10], [2099, 3, 15]);
      const lateNight = new Date(Date.UTC(2099, 2, 16, 1, 30));

      const stay = await service.findEligibleStay(guest, lateNight);

      expect(stay?.today).toBe('2099-03-15');
    });
  });

  describe('getSpaContextBlock (CA2/CA3/CA7)', () => {
    it('al huésped le presenta los servicios activos sin cargo', async () => {
      const guest = newGuest();
      await seedReservation(guest, [2099, 3, 10], [2099, 3, 20]);
      const active = await createSpa();
      const disabled = await createSpa({ status: SpaServiceStatus.INACTIVE });

      const block = await service.getSpaContextBlock(guest);

      expect(block).toContain('[SERVICIOS DEL HOTEL]');
      expect(block).toContain('HUÉSPED');
      expect(block).toContain(`id=${active.id}`);
      expect(block).toContain('SIN CARGO');
      expect(block).not.toContain(`id=${disabled.id}`);
    });

    it('a quien no se hospeda le presenta los mismos servicios con su precio', async () => {
      const active = await createSpa({ price: 23456 });

      const block = await service.getSpaContextBlock(newGuest());

      expect(block).toContain('EXTERNO');
      expect(block).toContain(`id=${active.id}`);
      expect(block).toContain('$23456');
      expect(block).not.toContain('SIN CARGO');
    });

    it('un servicio que se deshabilita deja de aparecer en la próxima consulta', async () => {
      const guest = newGuest();
      const spa = await createSpa();

      expect(await service.getSpaContextBlock(guest)).toContain(`id=${spa.id}`);

      await service.remove(spa.id);

      expect(await service.getSpaContextBlock(guest)).not.toContain(
        `id=${spa.id}`,
      );
    });
  });
});
