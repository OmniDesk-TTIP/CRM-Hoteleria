import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';

export interface SalesByOriginRow {
  origin: string;
  count: number;
  deposits: number;
  total: number;
}

export interface HandoverCounts {
  totalSessions: number;
  handedOver: number;
}

/**
 * Consultas de solo lectura para el dashboard de métricas del bot. Los conteos y las sumas
 * se agregan en SQL para no traer las tablas enteras.
 *
 * `from` es un instante UTC (o null para el histórico). La base guarda `created_at` en UTC
 * (`timezone: 'UTC'` en la config del ORM), y el cast `?::timestamp` sobre un ISO con "Z"
 * descarta la zona y lo compara como hora UTC, que es lo que corresponde.
 */
@Injectable()
export class StatisticsRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Reservas confirmadas (o sea, pagadas) agrupadas por origen. Se filtran por `created_at`
   * porque la reserva no guarda la fecha de confirmación: es la fecha en que se cerró la venta.
   */
  async salesByOrigin(from: Date | null): Promise<SalesByOriginRow[]> {
    const params: unknown[] = [ReservationStatus.CONFIRMED];
    let where = 'status = ?';

    if (from) {
      where += ' AND created_at >= ?::timestamp';
      params.push(from.toISOString());
    }

    const rows = await this.em.getConnection().execute<
      {
        origin: string;
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

  /**
   * Conversaciones iniciadas en el período y cuántas requirieron un operador.
   *
   * No alcanza con mirar `status = 'HUMAN'`: al liberar un chat vuelve a BOT y se borra
   * `handover_requested_at`. Lo que queda como rastro es `taken_over_at` (un operador lo
   * tomó alguna vez) y `handover_requested_at` (pedido todavía pendiente). Si el fallback de
   * la IA marcó el chat pero el bot se recuperó, el pedido se borra y no cuenta: la IA lo resolvió.
   */
  async handoverCounts(from: Date | null): Promise<HandoverCounts> {
    const params: unknown[] = [];
    let where = 'TRUE';

    if (from) {
      where = 'created_at >= ?::timestamp';
      params.push(from.toISOString());
    }

    const [row] = await this.em.getConnection().execute<
      { total: string; handed_over: string }[]
    >(
      `
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (
               WHERE taken_over_at IS NOT NULL OR handover_requested_at IS NOT NULL
             ) AS handed_over
      FROM chat_sessions
      WHERE ${where}
      `,
      params,
    );

    return {
      totalSessions: Number(row?.total ?? 0),
      handedOver: Number(row?.handed_over ?? 0),
    };
  }
}
