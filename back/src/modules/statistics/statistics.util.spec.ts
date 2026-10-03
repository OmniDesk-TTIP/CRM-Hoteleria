import {
  percentage,
  rangeStartKey,
  round2,
  zonedStartOfDay,
} from './statistics.util';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';

describe('statistics.util', () => {
  describe('zonedStartOfDay', () => {
    it('devuelve el instante UTC en que empieza el día en Buenos Aires (UTC-3)', () => {
      expect(zonedStartOfDay('2026-10-01', BUENOS_AIRES).toISOString()).toBe(
        '2026-10-01T03:00:00.000Z',
      );
    });

    it('en UTC el día empieza a las 00:00Z', () => {
      expect(zonedStartOfDay('2026-10-01', 'UTC').toISOString()).toBe(
        '2026-10-01T00:00:00.000Z',
      );
    });

    it('respeta el cambio de horario de verano en zonas con DST', () => {
      const newYork = 'America/New_York';

      // El 8/3/2026 arranca el horario de verano a las 2:00: medianoche todavía es UTC-5.
      expect(zonedStartOfDay('2026-03-08', newYork).toISOString()).toBe(
        '2026-03-08T05:00:00.000Z',
      );
      // Un día después ya es UTC-4.
      expect(zonedStartOfDay('2026-03-09', newYork).toISOString()).toBe(
        '2026-03-09T04:00:00.000Z',
      );
    });
  });

  describe('rangeStartKey', () => {
    // 2026-10-02T01:00Z todavía es el 1 de octubre a las 22:00 en Buenos Aires.
    const NOW = new Date('2026-10-02T01:00:00Z');

    it('month arranca el día 1 del mes en curso, según el calendario del hotel', () => {
      expect(rangeStartKey('month', NOW, BUENOS_AIRES)).toBe('2026-10-01');
    });

    it('month no se adelanta al mes siguiente por la diferencia con UTC', () => {
      // 2026-10-01T02:00Z es el 30 de septiembre a las 23:00 en Buenos Aires.
      const lateSeptember = new Date('2026-10-01T02:00:00Z');
      expect(rangeStartKey('month', lateSeptember, BUENOS_AIRES)).toBe(
        '2026-09-01',
      );
    });

    it('7d incluye hoy y los 6 días anteriores', () => {
      expect(rangeStartKey('7d', NOW, BUENOS_AIRES)).toBe('2026-09-25');
    });

    it('7d cruza el cambio de mes', () => {
      const earlyMonth = new Date('2026-10-03T15:00:00Z');
      expect(rangeStartKey('7d', earlyMonth, BUENOS_AIRES)).toBe('2026-09-27');
    });

    it('all no tiene límite inferior', () => {
      expect(rangeStartKey('all', NOW, BUENOS_AIRES)).toBeNull();
    });
  });

  describe('percentage / round2', () => {
    it('redondea a un decimal', () => {
      expect(percentage(2, 3)).toBe(66.7);
      expect(percentage(1, 3)).toBe(33.3);
      expect(percentage(1, 1)).toBe(100);
    });

    it('con denominador 0 devuelve 0 y no NaN', () => {
      expect(percentage(0, 0)).toBe(0);
      expect(percentage(5, 0)).toBe(0);
    });

    it('round2 redondea a dos decimales', () => {
      expect(round2(10.456)).toBe(10.46);
      expect(round2(0)).toBe(0);
    });
  });
});
