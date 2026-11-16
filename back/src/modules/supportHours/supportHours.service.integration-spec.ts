import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getBotToken } from 'nestjs-telegraf';
import { MikroORM } from '@mikro-orm/core';
import { AppModule } from '../../app.module';
import { RagService } from '../rag/rag.service';
import { PaymentService } from '../payment/payment.service';
import { SupportHoursService } from './supportHours.service';
import { SupportHoursRepository } from './supportHours.repository';
import { SupportHours } from '../../infrastructure/database/entities/SupportHours.entity';

type Day = Pick<SupportHours, 'weekday' | 'isClosed' | 'opensAt' | 'closesAt'>;

/** 2026-09-21T12:00:00Z son las 09:00 del lunes en Buenos Aires (UTC-3). */
const MONDAY_09_00 = new Date('2026-09-21T12:00:00Z');
const MONDAY_08_59 = new Date('2026-09-21T11:59:00Z');
const MONDAY_21_30 = new Date('2026-09-22T00:30:00Z');

function buildWeek(
  overrides: Partial<Record<number, Partial<Day>>> = {},
): Day[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '09:00',
    closesAt: '21:00',
    ...overrides[weekday],
  }));
}

// Autorización, validación del DTO, crear la semana sobre la tabla vacía, el PUT idempotente y
// el día abierto que abre y cierra a la misma hora ya los cubre test/supportHours.e2e-spec.ts.
// getAvailability no tiene endpoint propio (lo usan chat y dashboard), así que se prueba acá.
describe('SupportHoursService (integración)', () => {
  let app: INestApplication;
  let orm: MikroORM;
  let service: SupportHoursService;
  let repository: SupportHoursRepository;
  // La tabla es global: se guarda lo que había para devolverla al terminar.
  let previousWeek: Day[] = [];

  const saveWeek = async (days: Day[]) => {
    const em = orm.em.fork();
    await em.nativeDelete(SupportHours, {});
    days.forEach((day) => em.create(SupportHours, day));
    await em.flush();
    orm.em.clear();
  };

  const persistedWeek = async () =>
    (
      await orm.em
        .fork()
        .find(SupportHours, {}, { orderBy: { weekday: 'ASC' } })
    ).map(({ weekday, isClosed, opensAt, closesAt }) => ({
      weekday,
      isClosed,
      opensAt,
      closesAt,
    }));

  /** Mismo repositorio contra la base, con otra SUPPORT_TIMEZONE. */
  const serviceIn = (timeZone: string) =>
    new SupportHoursService(repository, {
      get: () => timeZone,
    } as unknown as ConfigService);

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
    service = app.get(SupportHoursService);
    repository = app.get(SupportHoursRepository);
    previousWeek = await persistedWeek();
  });

  beforeEach(async () => {
    await saveWeek(buildWeek());
  });

  afterAll(async () => {
    try {
      await saveWeek(previousWeek);
    } catch {
      // no-op: limpieza best-effort
    } finally {
      if (app) await app.close();
    }
  });

  describe('getAvailability', () => {
    it('está abierto justo en el minuto de apertura', async () => {
      await expect(service.getAvailability(MONDAY_09_00)).resolves.toEqual({
        isOpen: true,
        nextOpeningLabel: null,
      });
    });

    it('está cerrado un minuto antes de abrir y avisa que abre hoy', async () => {
      await expect(service.getAvailability(MONDAY_08_59)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: 'hoy a las 09:00',
      });
    });

    it('está cerrado después del horario de cierre y avisa que abre mañana', async () => {
      await expect(service.getAvailability(MONDAY_21_30)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: 'mañana a las 09:00',
      });
    });

    it('saltea los días marcados como cerrados al buscar la próxima apertura', async () => {
      await saveWeek(buildWeek({ 2: { isClosed: true } }));

      await expect(service.getAvailability(MONDAY_21_30)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: 'el miércoles a las 09:00',
      });
    });

    it('con la semana entera cerrada no promete ninguna apertura', async () => {
      await saveWeek(buildWeek().map((day) => ({ ...day, isClosed: true })));

      await expect(service.getAvailability(MONDAY_09_00)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: null,
      });
    });

    it('sin horarios cargados se atiende siempre: tabla vacía es "no configurado", no "cerrado"', async () => {
      await saveWeek([]);

      await expect(service.getAvailability(MONDAY_21_30)).resolves.toEqual({
        isOpen: true,
        nextOpeningLabel: null,
      });
    });

    it('soporta turnos que cruzan la medianoche', async () => {
      await saveWeek(buildWeek({ 1: { opensAt: '20:00', closesAt: '02:00' } }));

      await expect(
        service.getAvailability(MONDAY_21_30),
      ).resolves.toMatchObject({ isOpen: true });
      await expect(
        service.getAvailability(MONDAY_09_00),
      ).resolves.toMatchObject({ isOpen: false });
    });

    it('interpreta la hora en la zona del hotel y no en UTC', async () => {
      // 10:00Z del lunes: en UTC ya abrió, en Buenos Aires todavía son las 07:00.
      const mondayTenUtc = new Date('2026-09-21T10:00:00Z');

      await expect(
        serviceIn('UTC').getAvailability(mondayTenUtc),
      ).resolves.toMatchObject({ isOpen: true });
      await expect(service.getAvailability(mondayTenUtc)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: 'hoy a las 09:00',
      });
    });

    it('cae a UTC si SUPPORT_TIMEZONE no es una zona válida, sin romper', async () => {
      const broken = serviceIn('Marte/Olympus_Mons');

      expect(broken.getTimeZone()).toBe('UTC');
      await expect(broken.getAvailability(MONDAY_09_00)).resolves.toEqual({
        isOpen: true,
        nextOpeningLabel: null,
      });
    });
  });

  describe('getDaySchedule', () => {
    it('devuelve el horario del día en la zona del hotel', async () => {
      await saveWeek(buildWeek({ 1: { opensAt: '08:00', closesAt: '20:00' } }));

      expect(await service.getDaySchedule(MONDAY_09_00)).toMatchObject({
        weekday: 1,
        isClosed: false,
        opensAt: '08:00',
        closesAt: '20:00',
      });
    });

    it('sin horarios cargados devuelve null', async () => {
      await saveWeek([]);

      expect(await service.getDaySchedule(MONDAY_09_00)).toBeNull();
    });
  });

  describe('replaceSchedule', () => {
    const newWeek = buildWeek().map((day) => ({
      ...day,
      opensAt: '08:00',
      closesAt: '22:00',
    }));

    it('rechaza una semana con días repetidos y no toca lo guardado', async () => {
      const duplicated = newWeek.map((day) => ({ ...day, weekday: 1 }));

      await expect(
        service.replaceSchedule({ days: duplicated }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(persistedWeek()).resolves.toEqual(buildWeek());
    });

    it('permite apertura = cierre cuando el día está marcado como cerrado', async () => {
      const days = newWeek.map((day) =>
        day.weekday === 3
          ? { ...day, isClosed: true, opensAt: '00:00', closesAt: '00:00' }
          : day,
      );

      await service.replaceSchedule({ days });

      await expect(persistedWeek()).resolves.toEqual(days);
    });
  });
});
