import { SpaServiceStatus } from '../../../infrastructure/database/entities/SpaService.entity';
import {
  buildGuestServicesBlock,
  MAX_DESCRIPTION_LENGTH,
  MAX_SPA_SERVICES_IN_BLOCK,
  SpaServiceModel,
  SpaServiceProps,
} from './spa.model';

/**
 * Solo reglas puras. Alta, edición, baja, validación de horario y elegibilidad se prueban contra
 * la base en spa.service.integration-spec.ts. Acá queda lo que no entra bien ahí: la matemática de
 * la franja horaria (sin armar un huésped y una reserva por cada borde) y el formato del bloque
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

describe('buildGuestServicesBlock', () => {
  it('lista cada servicio con id, duración, precio, días y horario', () => {
    const block = buildGuestServicesBlock([buildService()]);

    expect(block).toContain('[SERVICIOS DEL HOTEL]');
    expect(block).toContain(
      'id=spa-1 | Masaje descontracturante | 60 min | $15000 | lunes, martes, miércoles, jueves, viernes de 10:00 a 20:00',
    );
    expect(block).toContain('Masaje de 60 minutos');
  });

  it('dice "todos los días" con la semana completa y ordena empezando por lunes', () => {
    const all = buildGuestServicesBlock([
      buildService({ availableWeekdays: [0, 1, 2, 3, 4, 5, 6] }),
    ]);
    const weekend = buildGuestServicesBlock([
      buildService({ availableWeekdays: [0, 6] }),
    ]);

    expect(all).toContain('todos los días');
    expect(weekend).toContain('sábado, domingo');
  });

  it('avisa explícitamente cuando no hay servicios, para que el bot no invente', () => {
    expect(buildGuestServicesBlock([])).toContain(
      'No hay servicios de spa disponibles por el momento.',
    );
  });

  it('trunca descripciones largas y limita la cantidad de servicios', () => {
    const long = buildGuestServicesBlock([
      buildService({ description: 'a'.repeat(MAX_DESCRIPTION_LENGTH + 100) }),
    ]);
    const many = buildGuestServicesBlock(
      Array.from({ length: MAX_SPA_SERVICES_IN_BLOCK + 5 }, (_, i) =>
        buildService({ id: `spa-${i}`, name: `Servicio ${i}` }),
      ),
    );

    expect(long).not.toContain('a'.repeat(MAX_DESCRIPTION_LENGTH + 1));
    expect(long).toContain('…');
    expect(many.match(/id=spa-/g)).toHaveLength(MAX_SPA_SERVICES_IN_BLOCK);
  });
});
