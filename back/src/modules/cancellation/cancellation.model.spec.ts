import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import {
  buildCancellationBlock,
  buildGuestCancellationReply,
  calculateRefund,
  CancellableReservation,
  CancellationPolicyModel,
  CancellationPreview,
  canCompleteRefund,
  daysUntilCheckIn,
  MAX_RESERVATIONS_IN_BLOCK,
} from './cancellation.model';
import { RefundStatus } from '../../infrastructure/database/entities/Reservation.entity';

const buildPolicy = (
  tiers = [
    { minDaysBeforeCheckIn: 7, refundPercentage: 100 },
    { minDaysBeforeCheckIn: 3, refundPercentage: 50 },
  ],
) => CancellationPolicyModel.create({ name: 'Flexible', tiers });

const buildReservation = (
  overrides: Partial<CancellableReservation> = {},
): CancellableReservation => ({
  id: 'res-1',
  status: ReservationStatus.CONFIRMED,
  checkIn: '2026-10-20',
  checkOut: '2026-10-22',
  depositAmount: 30000,
  ...overrides,
});

describe('CancellationPolicyModel.refundPercentageFor', () => {
  const policy = buildPolicy();

  it.each([
    [30, 100],
    [7, 100],
    [6, 50],
    [3, 50],
    [2, 0],
    [0, 0],
    [-1, 0],
  ])('con %i días de anticipación devuelve el %i%%', (days, expected) => {
    expect(policy.refundPercentageFor(days)).toBe(expected);
  });

  it('un escalón en 0 días cubre hasta el mismo día del check-in, pero no la estadía ya empezada', () => {
    const sameDay = buildPolicy([
      { minDaysBeforeCheckIn: 5, refundPercentage: 100 },
      { minDaysBeforeCheckIn: 0, refundPercentage: 20 },
    ]);

    expect(sameDay.refundPercentageFor(0)).toBe(20);
    expect(sameDay.refundPercentageFor(-1)).toBe(0);
  });
});

describe('CancellationPolicyModel.getTiersError', () => {
  it('acepta escalones válidos aunque lleguen desordenados', () => {
    const policy = buildPolicy([
      { minDaysBeforeCheckIn: 3, refundPercentage: 50 },
      { minDaysBeforeCheckIn: 7, refundPercentage: 100 },
    ]);

    expect(policy.getTiersError()).toBeNull();
    expect(policy.tiers.map((tier) => tier.minDaysBeforeCheckIn)).toEqual([
      7, 3,
    ]);
  });

  it('acepta devolver lo mismo en dos escalones', () => {
    const policy = buildPolicy([
      { minDaysBeforeCheckIn: 7, refundPercentage: 50 },
      { minDaysBeforeCheckIn: 3, refundPercentage: 50 },
    ]);

    expect(policy.getTiersError()).toBeNull();
  });

  it('rechaza días no enteros', () => {
    const policy = buildPolicy([
      { minDaysBeforeCheckIn: 2.5, refundPercentage: 50 },
    ]);

    expect(policy.getTiersError()).toMatch(/enteros/);
  });
});

describe('CancellationPolicyModel.describeTiers', () => {
  it('describe cada tramo y cierra con el de menos anticipación sin devolución', () => {
    expect(buildPolicy().describeTiers()).toEqual([
      'Con 7 días o más de anticipación: devolución del 100% de la seña',
      'Con entre 3 y 6 días de anticipación: devolución del 50% de la seña',
      'Con menos de 3 días de anticipación: sin devolución de la seña',
    ]);
  });

  it('usa singular y tramos de un solo día', () => {
    const policy = buildPolicy([
      { minDaysBeforeCheckIn: 2, refundPercentage: 100 },
      { minDaysBeforeCheckIn: 1, refundPercentage: 30 },
    ]);

    expect(policy.describeTiers()).toEqual([
      'Con 2 días o más de anticipación: devolución del 100% de la seña',
      'Con 1 día de anticipación: devolución del 30% de la seña',
      'Con menos de 1 día de anticipación: sin devolución de la seña',
    ]);
  });
});

describe('daysUntilCheckIn', () => {
  it('cuenta días de calendario, también al cruzar de mes y de año', () => {
    expect(daysUntilCheckIn('2026-10-20', '2026-10-13')).toBe(7);
    expect(daysUntilCheckIn('2027-01-02', '2026-12-30')).toBe(3);
    expect(daysUntilCheckIn('2026-10-20', '2026-10-20')).toBe(0);
    expect(daysUntilCheckIn('2026-10-20', '2026-10-21')).toBe(-1);
  });
});

describe('calculateRefund', () => {
  it('aplica el porcentaje sobre la seña', () => {
    expect(
      calculateRefund(buildPolicy(), buildReservation(), '2026-10-15'),
    ).toEqual({
      daysInAdvance: 5,
      wasPaid: true,
      policyName: 'Flexible',
      refundPercentage: 50,
      refundAmount: 15000,
    });
  });

  it('redondea el monto a centavos', () => {
    const policy = buildPolicy([
      { minDaysBeforeCheckIn: 0, refundPercentage: 33.33 },
    ]);

    const result = calculateRefund(
      policy,
      buildReservation({ depositAmount: 100.03 }),
      '2026-10-20',
    );

    expect(result.refundAmount).toBe(33.34);
  });

  it('sin política vigente no devuelve nada, pero la reserva igual cuenta como paga', () => {
    expect(calculateRefund(null, buildReservation(), '2026-10-01')).toMatchObject(
      { wasPaid: true, policyName: null, refundPercentage: 0, refundAmount: 0 },
    );
  });

  it('una reserva pendiente de pago no tiene nada que devolver aunque la política lo permita', () => {
    const result = calculateRefund(
      buildPolicy(),
      buildReservation({ status: ReservationStatus.PENDING_PAYMENT }),
      '2026-10-01',
    );

    expect(result).toMatchObject({
      wasPaid: false,
      refundPercentage: 0,
      refundAmount: 0,
    });
  });

  it('con la estadía ya empezada no devuelve nada', () => {
    const result = calculateRefund(
      buildPolicy(),
      buildReservation(),
      '2026-10-21',
    );

    expect(result).toMatchObject({ daysInAdvance: -1, refundAmount: 0 });
  });
});

describe('canCompleteRefund', () => {
  it('solo una devolución pendiente se puede marcar como realizada', () => {
    expect(canCompleteRefund(RefundStatus.PENDING)).toBe(true);
    expect(canCompleteRefund(RefundStatus.COMPLETED)).toBe(false);
    expect(canCompleteRefund(null)).toBe(false);
  });
});

describe('buildCancellationBlock', () => {
  const preview = (
    overrides: Partial<CancellationPreview> = {},
  ): CancellationPreview => ({
    reservationId: 'res-1',
    checkIn: '2026-10-20',
    checkOut: '2026-10-22',
    depositAmount: 30000,
    wasPaid: true,
    refundPercentage: 50,
    refundAmount: 15000,
    ...overrides,
  });

  it('sin política le indica al bot que no prometa devoluciones', () => {
    const block = buildCancellationBlock(null, []);

    expect(block).toContain('No hay una política de cancelación cargada');
    expect(block).not.toContain('RESERVAS DEL CLIENTE');
  });

  it('muestra las fechas en formato DD-MM-YYYY y el reintegro de cada reserva', () => {
    const block = buildCancellationBlock(buildPolicy(), [preview()]);

    expect(block).toContain(
      '- id=res-1 | del 20-10-2026 al 22-10-2026 | si cancela hoy se le devuelven $15000 (50% de la seña de $30000)',
    );
  });

  it('distingue una reserva sin devolución de una sin pagar', () => {
    const block = buildCancellationBlock(buildPolicy(), [
      preview({ reservationId: 'a', refundAmount: 0, refundPercentage: 0 }),
      preview({ reservationId: 'b', wasPaid: false, refundAmount: 0 }),
    ]);

    expect(block).toContain('id=a | del 20-10-2026 al 22-10-2026 | si cancela hoy no se le devuelve la seña de $30000');
    expect(block).toContain('id=b | del 20-10-2026 al 22-10-2026 | todavía sin pagar');
  });

  it('limita la cantidad de reservas para no inflar el prompt', () => {
    const previews = Array.from(
      { length: MAX_RESERVATIONS_IN_BLOCK + 3 },
      (_, index) => preview({ reservationId: `res-${index}` }),
    );

    const block = buildCancellationBlock(buildPolicy(), previews);

    expect(block.match(/id=res-/g)).toHaveLength(MAX_RESERVATIONS_IN_BLOCK);
  });
});

describe('buildGuestCancellationReply', () => {
  const stay = { checkIn: '2026-10-20', checkOut: '2026-10-22' };
  const calculation = calculateRefund(
    buildPolicy(),
    buildReservation(),
    '2026-10-15',
  );

  it('informa el monto a reintegrar y que queda pendiente', () => {
    const reply = buildGuestCancellationReply(calculation, stay);

    expect(reply).toContain('del 20-10-2026 al 22-10-2026');
    expect(reply).toContain('<b>$15000</b> (50% de la seña)');
    expect(reply).toContain('pendiente');
  });

  it('aclara cuando la política no devuelve nada', () => {
    const reply = buildGuestCancellationReply(
      { ...calculation, refundAmount: 0, refundPercentage: 0 },
      stay,
    );

    expect(reply).toContain('no corresponde devolución');
  });

  it('aclara cuando no había seña paga', () => {
    const reply = buildGuestCancellationReply(
      { ...calculation, wasPaid: false, refundAmount: 0 },
      stay,
    );

    expect(reply).toContain('No habías abonado la seña');
  });
});