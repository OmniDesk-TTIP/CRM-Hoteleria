import { IsIn, IsOptional } from 'class-validator';

/** Períodos del selector del dashboard: este mes, últimos 7 días e histórico. */
export const STATISTICS_RANGES = ['month', '7d', 'all'] as const;
export type StatisticsRange = (typeof STATISTICS_RANGES)[number];

export class StatisticsQueryDto {
  @IsOptional()
  @IsIn(STATISTICS_RANGES, {
    message: 'range inválido (usá month, 7d o all)',
  })
  range: StatisticsRange = 'month';
}

export class StatisticsSalesDto {
  /** Reservas confirmadas (pagadas) del período, sin importar el origen. */
  total!: number;
  /** Cerradas y pagadas de forma autónoma por el bot. */
  bot!: number;
  /** Cargadas a mano desde el panel. */
  manual!: number;
  /** Tasa de ventas del bot: bot / total, con un decimal. 0 si no hay reservas. */
  botPct!: number;
  manualPct!: number;
}

export class StatisticsRevenueDto {
  /** Seña cobrada por Mercado Pago en reservas del bot: lo realmente recaudado. */
  botDeposits!: number;
  /** Valor total de esas mismas reservas (seña + saldo que se paga en el hotel). */
  botTotalValue!: number;
}

export class StatisticsHandoverDto {
  /** Conversaciones de Telegram iniciadas en el período. */
  totalSessions!: number;
  /** De esas, las que requirieron (o están requiriendo) un operador humano. */
  handedOver!: number;
  /** Tasa de intervención: handedOver / totalSessions, con un decimal. 0 si no hay chats. */
  ratePct!: number;
}

export class StatisticsDto {
  range!: StatisticsRange;
  /** Primer día del período (YYYY-MM-DD, hora del hotel). null en el histórico. */
  from!: string | null;
  sales!: StatisticsSalesDto;
  revenue!: StatisticsRevenueDto;
  handover!: StatisticsHandoverDto;
}
