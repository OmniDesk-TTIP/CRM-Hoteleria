import { ArrivalMessageStatus } from '../../infrastructure/database/entities/ArrivalMessage.entity';
import {
  buildReminderMessage,
  buildWelcomeMessage,
  failureStatusOf,
  isReminderDue,
  isWelcomeDue,
  WelcomeInfo,
} from './arrivalMessage.model';

/**
 * Solo reglas puras. Qué reservas reciben cada mensaje y el registro de los envíos se prueban
 * contra la base en arrivalMessage.service.integration-spec.ts.
 */
const hours = (hour: number, minute = 0) => hour * 60 + minute;

const buildInfo = (overrides: Partial<WelcomeInfo> = {}): WelcomeInfo => ({
  checkInTime: '13:00',
  reception: { isClosed: false, opensAt: '09:00', closesAt: '21:00' },
  roomService: null,
  spaServices: [],
  restaurantSchedule: null,
  ...overrides,
});

describe('arrivalMessage.model', () => {
  describe('isReminderDue', () => {
    it('recién corresponde 24 hs antes del horario de ingreso', () => {
      expect(isReminderDue(hours(12, 59), '13:00')).toBe(false);
      expect(isReminderDue(hours(13), '13:00')).toBe(true);
      expect(isReminderDue(hours(23), '13:00')).toBe(true);
    });
  });

  describe('isWelcomeDue', () => {
    it('no despierta al huésped: corresponde desde las 09:00', () => {
      expect(isWelcomeDue(hours(8, 59))).toBe(false);
      expect(isWelcomeDue(hours(9))).toBe(true);
    });
  });

  describe('failureStatusOf', () => {
    it('distingue el bloqueo del bot de cualquier otro error', () => {
      expect(failureStatusOf({ code: 403 })).toBe(ArrivalMessageStatus.BLOCKED);
      expect(failureStatusOf({ code: 400 })).toBe(ArrivalMessageStatus.FAILED);
      expect(failureStatusOf({ code: 429 })).toBe(ArrivalMessageStatus.FAILED);
      expect(failureStatusOf(new Error('socket hang up'))).toBe(
        ArrivalMessageStatus.FAILED,
      );
    });
  });

  describe('buildReminderMessage', () => {
    it('trae la fecha, el horario de ingreso y cómo llegar (CA1)', () => {
      const message = buildReminderMessage(
        '  Ana María Pérez',
        '2097-03-20',
        '14:30',
        'A 4 cuadras de la plaza.',
      );

      expect(message).toMatch(/^¡Hola Ana!/);
      expect(message).toContain('Llegada: 20-03-2097');
      expect(message).toContain('a partir de las 14:30');
      expect(message).toContain('Cómo llegar: A 4 cuadras de la plaza.');
    });
  });

  describe('buildWelcomeMessage', () => {
    it('informa el check-in y el horario de recepción (CA2)', () => {
      const message = buildWelcomeMessage('Ana Pérez', buildInfo());

      expect(message).toMatch(/^¡Hola Ana!/);
      expect(message).toContain('Check-in: a partir de las 13:00');
      expect(message).toContain('Recepción: hoy de 09:00 a 21:00');
    });

    it('avisa si la recepción no atiende hoy y omite el dato si no hay horarios', () => {
      const closed = buildWelcomeMessage(
        'Ana',
        buildInfo({
          reception: { isClosed: true, opensAt: '09:00', closesAt: '21:00' },
        }),
      );
      const unknown = buildWelcomeMessage(
        'Ana',
        buildInfo({ reception: null }),
      );

      expect(closed).toContain('Recepción: hoy está cerrada');
      expect(unknown).not.toContain('Recepción');
    });

    it('incluye el room service solo si está habilitado', () => {
      const message = buildWelcomeMessage(
        'Ana',
        buildInfo({ roomService: { opensAt: '07:00', closesAt: '23:00' } }),
      );

      expect(message).toContain('Room service: de 07:00 a 23:00');
      expect(buildWelcomeMessage('Ana', buildInfo())).not.toContain(
        'Room service',
      );
    });

    it('ofrece el spa y el restó cuando corresponde', () => {
      const message = buildWelcomeMessage(
        'Ana',
        buildInfo({
          spaServices: ['Masajes', 'Sauna'],
          restaurantSchedule: 'todos los días de 20:00 a 23:00',
        }),
      );

      expect(message).toContain(
        'Spa, sin cargo para huéspedes: Masajes, Sauna',
      );
      expect(message).toContain('Restó: todos los días de 20:00 a 23:00');
      expect(message).toContain(
        'Si querés un turno de spa o una mesa en el restó, pedímelo por acá.',
      );
    });

    it('ofrece solo lo que está disponible', () => {
      const onlySpa = buildWelcomeMessage(
        'Ana',
        buildInfo({ spaServices: ['Masajes'] }),
      );
      const onlyRestaurant = buildWelcomeMessage(
        'Ana',
        buildInfo({ restaurantSchedule: 'todos los días de 20:00 a 23:00' }),
      );

      expect(onlySpa).toContain('Si querés un turno de spa, pedímelo');
      expect(onlySpa).not.toContain('Restó');
      expect(onlyRestaurant).toContain(
        'Si querés una mesa en el restó, pedímelo',
      );
      expect(onlyRestaurant).not.toContain('Spa');
    });

    it('sin spa ni restó no ofrece nada', () => {
      const message = buildWelcomeMessage('Ana', buildInfo());

      expect(message).not.toContain('Durante tu estadía');
      expect(message).not.toContain('Si querés');
    });
  });
});
