import { SpaServiceStatus } from '../../../infrastructure/database/entities/SpaService.entity';
import {
  buildSpaServicesBlock,
  hasFreeCapacity,
  MAX_DESCRIPTION_LENGTH,
  MAX_SPA_SERVICES_IN_BLOCK,
  SpaServiceModel,
  SpaServiceProps,
} from './spa.model';

/**
 * Solo reglas puras. Alta, edición, baja, validación de horario, elegibilidad y el cobro se
 * prueban contra la base en spa.service.integration-spec.ts y spaReservation.service.integration-spec.ts.
 * Acá queda lo que no entra bien ahí: la matemática de la franja horaria y de la capacidad (cada
 * borde sería un huésped, una reserva y un servicio armados en la base) y el formato del bloque
 * (la base de test es compartida, así que no se puede afirmar que "no hay servicios" ni cargar
 * 25 filas para probar el tope).
 */
const buildProps = (
  overrides: Partial<SpaServiceProps> = {},
): SpaServiceProps => ({
  id: 'spa-1',
  name: 'Masaje descontracturante',
  description: 'Masaje de 60 minutos',
  durationMinutes: 60,
  price: 15000,
  capacity: 1,
  status: SpaServiceStatus.ACTIVE,
  availableWeekdays: [1, 2, 3, 4, 5],
  opensAt: '10:00',
  closesAt: '20:00',
  ...overrides,
});

const buildService = (overrides: Partial<SpaServiceProps> = {}) =>
  new SpaServiceModel(buildProps(overrides));

describe('SpaServiceModel.isAvailableAt', () => {
  const model = buildService();

  it.each([
    ['dentro de la franja', 3, '15:30', true],
    ['justo a la apertura', 3, '10:00', true],
    ['un turno que termina justo al cierre', 3, '19:00', true],
    ['un turno que se pasa del cierre', 3, '19:01', false],
    ['antes de la apertura', 3, '09:59', false],
    ['un día de la semana no habilitado', 0, '12:00', false],
  ])('%s', (_label, weekday, startTime, expected) => {
    expect(model.isAvailableAt(weekday, startTime)).toBe(expected);
  });

  it('no está disponible nunca si el servicio está inactivo (CA7)', () => {
    const inactive = buildService({ status: SpaServiceStatus.INACTIVE });

    expect(inactive.canBeRequested()).toBe(false);
    expect(inactive.isAvailableAt(3, '12:00')).toBe(false);
  });
});

describe('hasFreeCapacity', () => {
  // [descripción, inicios ya reservados, inicio pedido, duración, capacidad, ¿entra?]
  it.each([
    ['no hay otros turnos', [], '15:00', 60, 1, true],
    ['mismo horario con capacidad 1', ['15:00'], '15:00', 60, 1, false],
    ['se superpone a mitad con capacidad 1', ['15:30'], '15:00', 60, 1, false],
    ['arranca justo cuando termina otro', ['14:00'], '15:00', 60, 1, true],
    ['termina justo cuando arranca otro', ['16:00'], '15:00', 60, 1, true],
    ['capacidad 2 con un turno en curso', ['15:00'], '15:00', 60, 2, true],
    [
      'capacidad 2 con dos turnos en curso',
      ['15:00', '15:00'],
      '15:00',
      60,
      2,
      false,
    ],
    [
      'capacidad 2 con dos turnos que no se superponen entre sí',
      ['15:00', '16:00'],
      '15:30',
      60,
      2,
      true,
    ],
    [
      'capacidad 2 con dos turnos que se superponen justo adentro',
      ['15:00', '15:20'],
      '15:10',
      60,
      2,
      false,
    ],
  ] as [string, string[], string, number, number, boolean][])(
    '%s',
    (_label, booked, start, duration, capacity, expected) => {
      expect(hasFreeCapacity(booked, start, duration, capacity)).toBe(expected);
    },
  );
});

describe('buildSpaServicesBlock', () => {
  it('lista cada servicio con id, duración, días y horario', () => {
    const block = buildSpaServicesBlock([buildService()], false);

    expect(block).toContain('[SERVICIOS DEL HOTEL]');
    expect(block).toContain(
      'id=spa-1 | Masaje descontracturante | 60 min | $15000 | lunes, martes, miércoles, jueves, viernes de 10:00 a 20:00',
    );
    expect(block).toContain('Masaje de 60 minutos');
  });

  it('al huésped se lo presenta sin cargo y al externo con precio y cobro', () => {
    const guest = buildSpaServicesBlock([buildService()], true);
    const external = buildSpaServicesBlock([buildService()], false);

    expect(guest).toContain('HUÉSPED');
    expect(guest).toContain('SIN CARGO');
    expect(guest).not.toContain('$15000');

    expect(external).toContain('EXTERNO');
    expect(external).toContain('$15000');
    expect(external).not.toContain('SIN CARGO');
  });

  it('dice "todos los días" con la semana completa y ordena empezando por lunes', () => {
    const all = buildSpaServicesBlock(
      [buildService({ availableWeekdays: [0, 1, 2, 3, 4, 5, 6] })],
      true,
    );
    const weekend = buildSpaServicesBlock(
      [buildService({ availableWeekdays: [0, 6] })],
      true,
    );

    expect(all).toContain('todos los días');
    expect(weekend).toContain('sábado, domingo');
  });

  it('avisa explícitamente cuando no hay servicios, para que el bot no invente', () => {
    expect(buildSpaServicesBlock([], true)).toContain(
      'No hay servicios de spa disponibles por el momento.',
    );
  });

  it('trunca descripciones largas y limita la cantidad de servicios', () => {
    const long = buildSpaServicesBlock(
      [buildService({ description: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 100) })],
      true,
    );
    const many = buildSpaServicesBlock(
      Array.from({ length: MAX_SPA_SERVICES_IN_BLOCK + 5 }, (_, i) =>
        buildService({ id: `spa-${i}`, name: `Servicio ${i}` }),
      ),
      true,
    );

    expect(long).not.toContain('a'.repeat(MAX_DESCRIPTION_LENGTH + 1));
    expect(long).toContain('…');
    expect(many.match(/id=spa-/g)).toHaveLength(MAX_SPA_SERVICES_IN_BLOCK);
  });
});
