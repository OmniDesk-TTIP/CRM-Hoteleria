import { DashboardService } from './dashboard.service';
import { DashboardRepository } from './dashboard.repository';
import { SupportHoursService } from '../supportHours/supportHours.service';
import {
  Reservation,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';
import {
  Room,
  RoomStatus,
} from '../../infrastructure/database/entities/Room.entity';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { addMonths, zonedDateKey } from './dashboard.util';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

/** 2026-09-26T01:00:00Z todavía es el 25 a las 22:00 en Buenos Aires: "hoy" tiene que ser el 25. */
const NOW = new Date('2026-09-26T01:00:00Z');

const USER: AuthUser = {
  id: 'user-1',
  email: 'recepcion@hotel.test',
  role: UserRole.EMPLOYEE,
};

const room = (id: string, roomNumber: string, status = RoomStatus.ACTIVE) =>
  ({ id, roomNumber, status, category: { name: 'Doble' } }) as unknown as Room;

// Las columnas `date` llegan como string desde MikroORM.
const reservation = (
  roomId: string,
  checkIn: string,
  checkOut: string,
  status: ReservationStatus,
) =>
  ({
    room: { id: roomId },
    checkIn,
    checkOut,
    status,
  }) as unknown as Reservation;

describe('DashboardService', () => {
  let repository: jest.Mocked<DashboardRepository>;
  let supportHours: jest.Mocked<
    Pick<SupportHoursService, 'getTimeZone' | 'getAvailability'>
  >;
  let service: DashboardService;

  beforeEach(() => {
    repository = {
      countWaitingHuman: jest.fn().mockResolvedValue(2),
      countActiveChatsOf: jest.fn().mockResolvedValue(1),
      countPendingPayment: jest.fn().mockResolvedValue(3),
      countCheckIns: jest.fn().mockResolvedValue(4),
      findDashboardRooms: jest
        .fn()
        .mockResolvedValue([
          room('r1', '101'),
          room('r2', '102'),
          room('r3', '201', RoomStatus.MAINTENANCE),
        ]),
      findLiveOverlapping: jest.fn().mockResolvedValue([
        // Arrancó antes de hoy: solo cuentan las noches desde hoy. La noche del 27 es el check-out.
        reservation(
          'r1',
          '2026-09-23',
          '2026-09-27',
          ReservationStatus.CONFIRMED,
        ),
        reservation(
          'r2',
          '2026-09-30',
          '2026-10-02',
          ReservationStatus.PENDING_PAYMENT,
        ),
      ]),
      findUpcoming: jest.fn().mockResolvedValue([]),
      revenueByMonth: jest.fn().mockResolvedValue([
        { month: '2026-09', total: 60000, nights: 4 },
        { month: '2026-07', total: 12000, nights: 1 },
      ]),
      confirmedNightsBetween: jest.fn().mockResolvedValue(15),
      countActiveRooms: jest.fn().mockResolvedValue(2),
    } as unknown as jest.Mocked<DashboardRepository>;

    supportHours = {
      getTimeZone: jest.fn().mockReturnValue(TIMEZONE),
      getAvailability: jest.fn().mockResolvedValue({
        isOpen: false,
        nextOpeningLabel: 'mañana a las 09:00',
      }),
    };

    service = new DashboardService(
      repository,
      supportHours as unknown as SupportHoursService,
    );
  });

  it('calcula "hoy" en la zona horaria del hotel y no en UTC', async () => {
    const summary = await service.getSummary(USER, NOW);

    expect(summary.today).toBe('2026-09-25');
    expect(repository.countCheckIns).toHaveBeenCalledWith('2026-09-25');
    expect(repository.countActiveChatsOf).toHaveBeenCalledWith('user-1');
  });

  it('arma la grilla de ocupación de 14 días sin contar la noche del check-out', async () => {
    const { occupancy } = await service.getSummary(USER, NOW);

    expect(occupancy.days).toHaveLength(14);
    expect(occupancy.days[0]).toBe('2026-09-25');
    expect(occupancy.days[13]).toBe('2026-10-08');

    const [r1, r2, r3] = occupancy.rooms;
    expect(r1.cells.slice(0, 3)).toEqual(['booked', 'booked', 'free']);
    expect(r2.cells.slice(4, 8)).toEqual([
      'free',
      'pending',
      'pending',
      'free',
    ]);
    expect(r3.cells.every((cell) => cell === 'maintenance')).toBe(true);

    // 2 noches de r1 + 2 de r2 sobre 28 noches disponibles (la habitación en mantenimiento no cuenta).
    expect(occupancy.occupancyPct).toBe(14.3);
  });

  it('completa los 12 meses de ingresos con cero y calcula la tarifa promedio del mes', async () => {
    const { revenue } = await service.getSummary(USER, NOW);

    expect(revenue.month).toBe('2026-09');
    expect(revenue.byMonth).toHaveLength(12);
    expect(revenue.byMonth[0].month).toBe('2025-10');
    expect(revenue.byMonth[11]).toEqual({ month: '2026-09', total: 60000 });
    expect(
      revenue.byMonth.find((point) => point.month === '2026-08')?.total,
    ).toBe(0);
    expect(revenue.monthTotal).toBe(60000);
    expect(revenue.adr).toBe(15000);
    // 15 noches confirmadas / (2 habitaciones activas × 30 días).
    expect(revenue.monthOccupancyPct).toBe(25);
    expect(repository.revenueByMonth).toHaveBeenCalledWith(
      '2025-10-01',
      '2026-10-01',
    );
  });

  it('no divide por cero cuando no hay ventas ni habitaciones activas', async () => {
    repository.revenueByMonth.mockResolvedValue([]);
    repository.confirmedNightsBetween.mockResolvedValue(0);
    repository.countActiveRooms.mockResolvedValue(0);

    const { revenue } = await service.getSummary(USER, NOW);

    expect(revenue.adr).toBe(0);
    expect(revenue.monthOccupancyPct).toBe(0);
  });

  it('devuelve el estado liviano para el layout', async () => {
    await expect(service.getStatus(NOW)).resolves.toEqual({
      waitingHuman: 2,
      support: { isOpen: false, nextOpeningLabel: 'mañana a las 09:00' },
    });
  });
});

describe('dashboard.util', () => {
  it('cruza el año al restar meses', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('formatea la fecha local en la zona pedida', () => {
    expect(zonedDateKey(NOW, 'UTC')).toBe('2026-09-26');
    expect(zonedDateKey(NOW, TIMEZONE)).toBe('2026-09-25');
  });
});
