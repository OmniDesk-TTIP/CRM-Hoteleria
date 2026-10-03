import { Injectable } from '@nestjs/common';
import { ReservationOrigin } from '../../infrastructure/database/entities/Reservation.entity';
import { SupportHoursService } from '../supportHours/supportHours.service';
import { StatisticsRepository } from './statistics.repository';
import { StatisticsDto, StatisticsRange } from './dto/statistics.dto';
import {
  percentage,
  rangeStartKey,
  round2,
  zonedStartOfDay,
} from './statistics.util';

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
    const fromKey = rangeStartKey(range, now, timeZone);
    const from = fromKey ? zonedStartOfDay(fromKey, timeZone) : null;

    const [salesRows, handover] = await Promise.all([
      this.statisticsRepository.salesByOrigin(from),
      this.statisticsRepository.handoverCounts(from),
    ]);

    const bot = salesRows.find((row) => row.origin === ReservationOrigin.BOT);
    const manual = salesRows.find(
      (row) => row.origin === ReservationOrigin.MANUAL,
    );
    const botCount = bot?.count ?? 0;
    const manualCount = manual?.count ?? 0;
    // Se suma BOT + MANUAL y no todas las filas: si mañana aparece otro origen, el gráfico
    // Bot vs Manual sigue sumando 100%.
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
      },
      handover: {
        totalSessions: handover.totalSessions,
        handedOver: handover.handedOver,
        ratePct: percentage(handover.handedOver, handover.totalSessions),
      },
    };
  }
}
