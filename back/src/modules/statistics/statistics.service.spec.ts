import { StatisticsService } from './statistics.service';
import { StatisticsRepository } from './statistics.repository';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { ReservationOrigin } from '../../infrastructure/database/entities/Reservation.entity';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

const NOW = new Date('2026-10-02T01:00:00Z');

describe('StatisticsService', () => {
  let repository: jest.Mocked<StatisticsRepository>;
  let supportHours: jest.Mocked<Pick<SupportHoursService, 'getTimeZone'>>;
  let service: StatisticsService;

  beforeEach(() => {
    repository = {
      salesByOrigin: jest.fn().mockResolvedValue([
        {
          origin: ReservationOrigin.BOT,
          count: 2,
          deposits: 60000,
          total: 200000,
        },
        {
          origin: ReservationOrigin.MANUAL,
          count: 1,
          deposits: 10000,
          total: 30000,
        },
      ]),
      handoverCounts: jest
        .fn()
        .mockResolvedValue({ totalSessions: 8, handedOver: 2 }),
    } as unknown as jest.Mocked<StatisticsRepository>;

    supportHours = { getTimeZone: jest.fn().mockReturnValue(TIMEZONE) };

    service = new StatisticsService(
      repository,
      supportHours as unknown as SupportHoursService,
    );
  });

  it('"este mes" filtra desde las 00:00 del día 1 en hora del hotel, expresado en UTC', async () => {
    const stats = await service.getStatistics('month', NOW);

    expect(stats.range).toBe('month');
    expect(stats.from).toBe('2026-10-01');
    expect(repository.salesByOrigin).toHaveBeenCalledWith(
      new Date('2026-10-01T03:00:00.000Z'),
    );
    expect(repository.handoverCounts).toHaveBeenCalledWith(
      new Date('2026-10-01T03:00:00.000Z'),
    );
  });

  it('"últimos 7 días" arranca 6 días antes de hoy', async () => {
    const stats = await service.getStatistics('7d', NOW);

    expect(stats.from).toBe('2026-09-25');
    expect(repository.salesByOrigin).toHaveBeenCalledWith(
      new Date('2026-09-25T03:00:00.000Z'),
    );
  });

  it('"histórico" consulta sin límite inferior', async () => {
    const stats = await service.getStatistics('all', NOW);

    expect(stats.from).toBeNull();
    expect(repository.salesByOrigin).toHaveBeenCalledWith(null);
    expect(repository.handoverCounts).toHaveBeenCalledWith(null);
  });

  it('calcula la tasa de ventas del bot contra el total de reservas confirmadas (CA1)', async () => {
    const { sales } = await service.getStatistics('month', NOW);

    expect(sales).toEqual({
      total: 3,
      bot: 2,
      manual: 1,
      botPct: 66.7,
      manualPct: 33.3,
    });
  });

  it('los ingresos del bot son la seña cobrada y, aparte, el valor total de esas reservas (CA3)', async () => {
    const { revenue } = await service.getStatistics('month', NOW);

    expect(revenue).toEqual({ botDeposits: 60000, botTotalValue: 200000 });
  });

  it('calcula la tasa de intervención sobre las conversaciones del período (CA2)', async () => {
    const { handover } = await service.getStatistics('month', NOW);

    expect(handover).toEqual({
      totalSessions: 8,
      handedOver: 2,
      ratePct: 25,
    });
  });

  it('sin datos devuelve todo en cero, sin NaN', async () => {
    repository.salesByOrigin.mockResolvedValue([]);
    repository.handoverCounts.mockResolvedValue({
      totalSessions: 0,
      handedOver: 0,
    });

    const stats = await service.getStatistics('all', NOW);

    expect(stats.sales).toEqual({
      total: 0,
      bot: 0,
      manual: 0,
      botPct: 0,
      manualPct: 0,
    });
    expect(stats.revenue).toEqual({ botDeposits: 0, botTotalValue: 0 });
    expect(stats.handover.ratePct).toBe(0);
  });

  it('si solo hay reservas manuales, el bot queda en 0% y los ingresos del bot en 0', async () => {
    repository.salesByOrigin.mockResolvedValue([
      {
        origin: ReservationOrigin.MANUAL,
        count: 4,
        deposits: 40000,
        total: 120000,
      },
    ]);

    const { sales, revenue } = await service.getStatistics('month', NOW);

    expect(sales.botPct).toBe(0);
    expect(sales.manualPct).toBe(100);
    expect(revenue).toEqual({ botDeposits: 0, botTotalValue: 0 });
  });

  it('ignora orígenes desconocidos para que Bot vs Manual siga sumando 100%', async () => {
    repository.salesByOrigin.mockResolvedValue([
      { origin: ReservationOrigin.BOT, count: 1, deposits: 1000, total: 3000 },
      {
        origin: ReservationOrigin.MANUAL,
        count: 1,
        deposits: 1000,
        total: 3000,
      },
      {
        origin: 'WEB' as ReservationOrigin,
        count: 5,
        deposits: 9999,
        total: 99999,
      },
    ]);

    const { sales } = await service.getStatistics('month', NOW);

    expect(sales.total).toBe(2);
    expect(sales.botPct + sales.manualPct).toBe(100);
  });
});
