import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  ReservationOrigin,
  ReservationStatus,
} from '../../infrastructure/database/entities/Reservation.entity';

export interface SalesByOriginRow {
  origin: ReservationOrigin;
  count: number;
  deposits: number;
  total: number;
}

export interface CancellationRevenueTotals {
  /** Seña que el hotel se quedó de reservas pagadas y canceladas (seña menos lo devuelto). */
  retained: number;
  /** Devoluciones generadas por cancelaciones que todavía no se hicieron. */
  refundsPending: number;
  /** Devoluciones ya realizadas. */
  refundsCompleted: number;
}

interface HandoverRow {
  total: string;
  handed_over: string;
}

export interface HandoverCounts {
  totalSessions: number;
  handedOver: number;
}

@Injectable()
export class StatisticsRepository {
  constructor(private readonly em: EntityManager) {}

  async salesByOrigin(from: Date | null): Promise<SalesByOriginRow[]> {
    const params: unknown[] = [ReservationStatus.CONFIRMED];
    let where = 'status = ?';

    if (from) {
      where += ' AND created_at >= ?::timestamp';
      params.push(from.toISOString());
    }

    const rows = await this.em.getConnection().execute<
      {
        origin: ReservationOrigin;
        count: string;
        deposits: string;
        total: string;
      }[]
    >(
      `
      SELECT origin,
             COUNT(*) AS count,
             COALESCE(SUM(deposit_amount), 0) AS deposits,
             COALESCE(SUM(total_amount), 0) AS total
      FROM reservations
      WHERE ${where}
      GROUP BY origin
      `,
      params,
    );

    return rows.map((row) => ({
      origin: row.origin,
      count: Number(row.count),
      deposits: Number(row.deposits),
      total: Number(row.total),
    }));
  }

  async cancellationTotals(
    from: Date | null,
  ): Promise<CancellationRevenueTotals> {
    const params: unknown[] = [ReservationStatus.CANCELLED];
    let where = 'status = ? AND refund_amount IS NOT NULL';

    if (from) {
      where += ' AND cancelled_at >= ?::timestamp';
      params.push(from.toISOString());
    }

    const [row] = await this.em.getConnection().execute<
      {
        retained: string;
        refunds_pending: string;
        refunds_completed: string;
      }[]
    >(
      `
      SELECT COALESCE(SUM(deposit_amount - refund_amount), 0) AS retained,
             COALESCE(SUM(refund_amount) FILTER (WHERE refund_status = 'PENDING'), 0) AS refunds_pending,
             COALESCE(SUM(refund_amount) FILTER (WHERE refund_status = 'COMPLETED'), 0) AS refunds_completed
      FROM reservations
      WHERE ${where}
      `,
      params,
    );

    return {
      retained: Number(row?.retained ?? 0),
      refundsPending: Number(row?.refunds_pending ?? 0),
      refundsCompleted: Number(row?.refunds_completed ?? 0),
    };
  }

  async handoverCounts(from: Date | null): Promise<HandoverCounts> {
    const params: unknown[] = [];
    let where = 'TRUE';

    if (from) {
      where = 'created_at >= ?::timestamp';
      params.push(from.toISOString());
    }

    const sql = `
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (
               WHERE taken_over_at IS NOT NULL OR handover_requested_at IS NOT NULL
             ) AS handed_over
      FROM chat_sessions
      WHERE ${where}
    `;
    const connection = this.em.getConnection();
    const [row] = await connection.execute<HandoverRow[]>(sql, params);

    return {
      totalSessions: Number(row?.total ?? 0),
      handedOver: Number(row?.handed_over ?? 0),
    };
  }
}
