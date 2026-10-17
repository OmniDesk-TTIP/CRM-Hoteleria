import { Injectable } from '@nestjs/common';
import { ReservationOrigin } from '../../infrastructure/database/entities/Reservation.entity';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { StatisticsRepository } from './statistics.repository';
import { StatisticsDto, StatisticsRange } from './dto/statistics.dto';
import { addDays, zonedDateKey, zonedStartOfDay } from '../../common/date.util';
import { percentage, round2 } from '../../common/number.util';

@Injectable()
export class StatisticsService {
  constructor(
    private readonly statisticsRepository: StatisticsRepository,
    private readonly supportHoursService: SupportHoursService,
  ) {}

  async getStatistics(
    range: StatisticsRange,
    now: Date = new Date(),
  ): Promise<StatisticsDto> {
    const timeZone = this.supportHoursService.getTimeZone();
    const fromKey = this.rangeStartKey(range, now, timeZone);
    const from = fromKey ? zonedStartOfDay(fromKey, timeZone) : null;

    const [salesRows, handover, cancellations] = await Promise.all([
      this.statisticsRepository.salesByOrigin(from),
      this.statisticsRepository.handoverCounts(from),
      this.statisticsRepository.cancellationTotals(from),
    ]);

    const bot = salesRows.find((row) => row.origin === ReservationOrigin.BOT);
    const manual = salesRows.find(
      (row) => row.origin === ReservationOrigin.MANUAL,
    );
    const botCount = bot?.count ?? 0;
    const manualCount = manual?.count ?? 0;
    const total = botCount + manualCount;

    return {
      range,
      from: fromKey,
      sales: {
        total,
        bot: botCount,
        manual: manualCount,
        botPct: percentage(botCount, total),
        manualPct: percentage(manualCount, total),
      },
      revenue: {
        botDeposits: round2(bot?.deposits ?? 0),
        botTotalValue: round2(bot?.total ?? 0),
        cancellationRetained: round2(cancellations.retained),
        refundsPending: round2(cancellations.refundsPending),
        refundsCompleted: round2(cancellations.refundsCompleted),
      },
      handover: {
        totalSessions: handover.totalSessions,
        handedOver: handover.handedOver,
        ratePct: percentage(handover.handedOver, handover.totalSessions),
      },
    };
  }

  private rangeStartKey(
    range: StatisticsRange,
    now: Date,
    timeZone: string,
  ): string | null {
    if (range === 'all') return null;

    const today = zonedDateKey(now, timeZone);
    return range === 'month' ? `${today.slice(0, 7)}-01` : addDays(today, -6);
  }
}
