import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupportHoursService } from './supportHours.service';
import { SupportHoursRepository } from './supportHours.repository';
import { SupportHours } from '../../infrastructure/database/entities/SupportHours.entity';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

/** 2026-09-21T12:00:00Z son las 09:00 del lunes en Buenos Aires (UTC-3). */
const MONDAY_09_00 = new Date('2026-09-21T12:00:00Z');
const MONDAY_08_59 = new Date('2026-09-21T11:59:00Z');
const MONDAY_21_30 = new Date('2026-09-22T00:30:00Z');

function buildWeek(overrides: Partial<Record<number, Partial<SupportHours>>> = {}): SupportHours[] {
  return Array.from({ length: 7 }, (_, weekday) => ({
    id: `day-${weekday}`,
    weekday,
    isClosed: false,
    opensAt: '09:00',
    closesAt: '21:00',
    ...overrides[weekday],
  })) as SupportHours[];
}

describe('SupportHoursService', () => {
  let service: SupportHoursService;
  let repository: jest.Mocked<Pick<SupportHoursRepository, 'findAll' | 'count' | 'create' | 'flush'>>;

  function buildService(timeZone: string = TIMEZONE): SupportHoursService {
    const configService = { get: jest.fn().mockReturnValue(timeZone) } as unknown as ConfigService;
    return new SupportHoursService(repository as unknown as SupportHoursRepository, configService);
  }

  beforeEach(() => {
    repository = {
      findAll: jest.fn().mockResolvedValue(buildWeek()),
      count: jest.fn().mockResolvedValue(7),
      create: jest.fn((day) => day as SupportHours),
      flush: jest.fn().mockResolvedValue(undefined),
    };
    service = buildService();
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
      // Martes cerrado: a las 21:30 del lunes, la próxima apertura es el miércoles.
      repository.findAll.mockResolvedValue(buildWeek({ 2: { isClosed: true } }));

      await expect(service.getAvailability(MONDAY_21_30)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: 'el miércoles a las 09:00',
      });
    });

    it('con la semana entera cerrada no promete ninguna apertura', async () => {
      repository.findAll.mockResolvedValue(
        buildWeek(Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, { isClosed: true }]))),
      );

      await expect(service.getAvailability(MONDAY_09_00)).resolves.toEqual({
        isOpen: false,
        nextOpeningLabel: null,
      });
    });

    it('sin horarios cargados se atiende siempre: tabla vacía es "no configurado", no "cerrado"', async () => {
      repository.findAll.mockResolvedValue([]);

      await expect(service.getAvailability(MONDAY_21_30)).resolves.toEqual({
        isOpen: true,
        nextOpeningLabel: null,
      });
    });

    it('soporta turnos que cruzan la medianoche', async () => {
      repository.findAll.mockResolvedValue(buildWeek({ 1: { opensAt: '20:00', closesAt: '02:00' } }));

      await expect(service.getAvailability(MONDAY_21_30)).resolves.toMatchObject({ isOpen: true });
      await expect(service.getAvailability(MONDAY_09_00)).resolves.toMatchObject({ isOpen: false });
    });

    it('interpreta la hora en la zona del hotel y no en la del server', async () => {
      // Las 21:30 de Buenos Aires son las 00:30 UTC del día siguiente: leído en UTC estaría abierto.
      const utcService = buildService('UTC');

      await expect(utcService.getAvailability(MONDAY_21_30)).resolves.toMatchObject({ isOpen: false });
      await expect(service.getAvailability(MONDAY_21_30)).resolves.toMatchObject({ isOpen: false });
    });

    it('cae a UTC si SUPPORT_TIMEZONE no es una zona válida, sin romper', async () => {
      const brokenService = buildService('Marte/Olympus_Mons');

      await expect(brokenService.getAvailability(MONDAY_09_00)).resolves.toBeDefined();
      await expect(brokenService.getSchedule()).resolves.toMatchObject({ timeZone: 'UTC' });
    });
  });

  describe('replaceSchedule', () => {
    const validWeek = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      isClosed: false,
      opensAt: '08:00',
      closesAt: '22:00',
    }));

    it('rechaza una semana con días repetidos', async () => {
      const duplicated = validWeek.map((day) => ({ ...day, weekday: 1 }));

      await expect(service.replaceSchedule({ days: duplicated })).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.flush).not.toHaveBeenCalled();
    });

    it('rechaza un día abierto cuya apertura y cierre son la misma hora', async () => {
      const degenerate = validWeek.map((day) =>
        day.weekday === 3 ? { ...day, opensAt: '10:00', closesAt: '10:00' } : day,
      );

      await expect(service.replaceSchedule({ days: degenerate })).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.flush).not.toHaveBeenCalled();
    });

    it('permite apertura = cierre cuando el día está marcado como cerrado', async () => {
      const closed = validWeek.map((day) =>
        day.weekday === 3 ? { ...day, isClosed: true, opensAt: '00:00', closesAt: '00:00' } : day,
      );

      await expect(service.replaceSchedule({ days: closed })).resolves.toBeDefined();
      expect(repository.flush).toHaveBeenCalledTimes(1);
    });

    it('crea las filas que falten en vez de fallar contra una base recién migrada', async () => {
      repository.findAll.mockResolvedValueOnce([]).mockResolvedValue(buildWeek());

      await service.replaceSchedule({ days: validWeek });

      expect(repository.create).toHaveBeenCalledTimes(7);
      expect(repository.flush).toHaveBeenCalledTimes(1);
    });
  });
});
