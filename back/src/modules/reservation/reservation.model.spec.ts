import {
  findGapFreeVariants,
  fromDayNumber,
  pickRoomAvoidingGap,
  RoomSchedule,
  toDayNumber,
} from './reservation.model';

const stay = (checkIn: number, checkOut: number) => ({ checkIn, checkOut });
const schedule = (roomId: string, ...bookings: [number, number][]) =>
  new RoomSchedule(
    roomId,
    bookings.map(([checkIn, checkOut]) => stay(checkIn, checkOut)),
  );

describe('reservation.model', () => {
  describe('toDayNumber / fromDayNumber', () => {
    it('da el mismo día para un string, una fecha local y una fecha a medianoche UTC', () => {
      const fromString = toDayNumber('2026-10-10');

      expect(toDayNumber(new Date(2026, 9, 10))).toBe(fromString);
      expect(toDayNumber(new Date(Date.UTC(2026, 9, 10)))).toBe(fromString);
      expect(toDayNumber('2026-10-10T00:00:00.000Z')).toBe(fromString);
    });

    it('cuenta días corridos entre fechas', () => {
      expect(toDayNumber('2026-10-15') - toDayNumber('2026-10-10')).toBe(5);
      expect(toDayNumber('2026-11-02') - toDayNumber('2026-10-30')).toBe(3);
    });

    it('fromDayNumber devuelve la fecha local a medianoche', () => {
      const date = fromDayNumber(toDayNumber('2026-10-10'));

      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(9);
      expect(date.getDate()).toBe(10);
      expect(date.getHours()).toBe(0);
    });
  });

  describe('RoomSchedule.leavesSingleNightGap (CA1)', () => {
    it('detecta una noche libre entre la estadía y una reserva posterior', () => {
      expect(schedule('r1', [15, 20]).leavesSingleNightGap(stay(10, 14))).toBe(
        true,
      );
    });

    it('detecta una noche libre entre una reserva anterior y la estadía', () => {
      expect(schedule('r1', [5, 9]).leavesSingleNightGap(stay(10, 13))).toBe(
        true,
      );
    });

    it('no hay hueco si la estadía queda pegada a la otra reserva', () => {
      expect(schedule('r1', [14, 20]).leavesSingleNightGap(stay(10, 14))).toBe(
        false,
      );
      expect(schedule('r1', [5, 10]).leavesSingleNightGap(stay(10, 13))).toBe(
        false,
      );
    });

    it('no es hueco si quedan dos noches libres o más, que sí se pueden vender', () => {
      expect(schedule('r1', [16, 20]).leavesSingleNightGap(stay(10, 14))).toBe(
        false,
      );
      expect(schedule('r1', [5, 8]).leavesSingleNightGap(stay(10, 13))).toBe(
        false,
      );
    });

    it('no hay hueco si la habitación no tiene reservas cerca', () => {
      expect(schedule('r1').leavesSingleNightGap(stay(10, 14))).toBe(false);
      expect(schedule('r1', [30, 35]).leavesSingleNightGap(stay(10, 14))).toBe(
        false,
      );
    });

    it('la noche suelta tiene que ser una sola: si otra reserva de una noche la ocupa, no hay hueco', () => {
      expect(
        schedule('r1', [5, 9], [9, 10]).leavesSingleNightGap(stay(10, 13)),
      ).toBe(false);
    });

    it('detecta el hueco aunque del otro lado la estadía esté pegada', () => {
      expect(
        schedule('r1', [5, 9], [13, 20]).leavesSingleNightGap(stay(10, 13)),
      ).toBe(true);
    });
  });

  describe('RoomSchedule.isFree y touchesBooking', () => {
    it('isFree es falso solo si una reserva se superpone (entrar el día que otro sale es válido)', () => {
      const room = schedule('r1', [10, 15]);

      expect(room.isFree(stay(12, 17))).toBe(false);
      expect(room.isFree(stay(15, 18))).toBe(true);
      expect(room.isFree(stay(5, 10))).toBe(true);
    });

    it('touchesBooking indica si la estadía queda pegada a otra reserva', () => {
      const room = schedule('r1', [15, 20]);

      expect(room.touchesBooking(stay(10, 15))).toBe(true);
      expect(room.touchesBooking(stay(10, 14))).toBe(false);
    });
  });

  describe('pickRoomAvoidingGap (CA2)', () => {
    it('prefiere la habitación que no deja hueco aunque no sea la primera', () => {
      const withGap = schedule('r1', [15, 20]);
      const clean = schedule('r2');

      const picked = pickRoomAvoidingGap([withGap, clean], stay(10, 14));

      expect(picked?.schedule.roomId).toBe('r2');
      expect(picked?.leavesGap).toBe(false);
    });

    it('si todas dejan hueco devuelve la primera libre, marcada con hueco', () => {
      const picked = pickRoomAvoidingGap(
        [schedule('r1', [15, 20]), schedule('r2', [15, 25])],
        stay(10, 14),
      );

      expect(picked?.schedule.roomId).toBe('r1');
      expect(picked?.leavesGap).toBe(true);
    });

    it('ignora las habitaciones ocupadas y devuelve null si ninguna está libre', () => {
      const busy = schedule('r1', [11, 13]);

      expect(pickRoomAvoidingGap([busy], stay(10, 14))).toBeNull();
      expect(
        pickRoomAvoidingGap([busy, schedule('r2', [15, 20])], stay(10, 14))
          ?.schedule.roomId,
      ).toBe('r2');
    });
  });

  describe('findGapFreeVariants (CA3)', () => {
    const kinds = (variants: { kind: string }[]) =>
      variants.map((variant) => variant.kind);

    it('con hueco después propone correr un día adelante y extender la salida', () => {
      const variants = findGapFreeVariants(
        stay(10, 14),
        [schedule('r1', [15, 20])],
        0,
        2,
      );

      expect(kinds(variants)).toEqual(['SHIFT_LATER', 'EXTEND_AFTER']);
      expect(variants[0].stay).toEqual(stay(11, 15));
      expect(variants[1].stay).toEqual(stay(10, 15));
    });

    it('con hueco antes propone correr un día atrás y llegar un día antes', () => {
      const variants = findGapFreeVariants(
        stay(10, 13),
        [schedule('r1', [5, 9])],
        0,
        2,
      );

      expect(kinds(variants)).toEqual(['SHIFT_EARLIER', 'EXTEND_BEFORE']);
      expect(variants[0].stay).toEqual(stay(9, 12));
      expect(variants[1].stay).toEqual(stay(9, 13));
    });

    it('descarta las variantes que empiezan antes del primer día reservable', () => {
      const variants = findGapFreeVariants(
        stay(10, 13),
        [schedule('r1', [5, 9])],
        10,
        2,
      );

      expect(variants).toEqual([]);
    });

    it('descarta las variantes que dejarían otro hueco del otro lado', () => {
      const variants = findGapFreeVariants(
        stay(10, 13),
        [schedule('r1', [5, 9], [14, 20])],
        0,
        4,
      );

      expect(kinds(variants)).toEqual(['SHIFT_LATER', 'SHIFT_EARLIER']);
    });

    it('respeta el límite de variantes', () => {
      const variants = findGapFreeVariants(
        stay(10, 14),
        [schedule('r1', [15, 20])],
        0,
        1,
      );

      expect(kinds(variants)).toEqual(['SHIFT_LATER']);
    });

    it('busca la variante en cualquier habitación libre y devuelve cuál es', () => {
      const variants = findGapFreeVariants(
        stay(10, 14),
        [schedule('r1', [11, 14]), schedule('r2', [15, 20])],
        0,
        2,
      );

      expect(variants.map((variant) => variant.roomId)).toEqual(['r2', 'r2']);
    });

    it('no propone nada si ninguna variante queda libre', () => {
      const variants = findGapFreeVariants(
        stay(10, 14),
        [schedule('r1', [8, 15], [15, 20])],
        0,
        2,
      );

      expect(variants).toEqual([]);
    });
  });
});