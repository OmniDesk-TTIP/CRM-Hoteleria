import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  Campaign,
  CampaignAudience,
  CampaignStatus,
  CampaignStayFilter,
} from '../../infrastructure/database/entities/Campaign.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { User } from '../../infrastructure/database/entities/User.entity';
import { RecipientFilter } from './campaign.model';

export interface NewCampaign {
  title: string;
  message: string;
  filter: Required<RecipientFilter>;
  hasImage: boolean;
  totalRecipients: number;
  createdById: string;
}

export interface CampaignProgress {
  sent: number;
  failed: number;
  blocked: number;
}

interface SqlClause {
  sql: string;
  params: unknown[];
}

const CONFIRMED_RESERVATION = `EXISTS (
  SELECT 1 FROM reservations r
  WHERE r.telegram_user_id = cs.telegram_user_id AND r.status = ?
)`;

function audienceCondition(audience: CampaignAudience): SqlClause | null {
  switch (audience) {
    case CampaignAudience.CONFIRMED:
      return {
        sql: CONFIRMED_RESERVATION,
        params: [ReservationStatus.CONFIRMED],
      };
    case CampaignAudience.NO_RESERVATION:
      return {
        sql: `NOT ${CONFIRMED_RESERVATION}`,
        params: [ReservationStatus.CONFIRMED],
      };
    default:
      return null;
  }
}

/** Condiciones sobre una reserva `r` según el estado de la estadía, relativas a `today` (YYYY-MM-DD). */
function stayConditions(
  stayFilter: CampaignStayFilter | null,
  today: string,
): SqlClause[] {
  const confirmed = {
    sql: 'r.status = ?',
    params: [ReservationStatus.CONFIRMED],
  };
  switch (stayFilter) {
    case CampaignStayFilter.IN_HOUSE:
      return [
        confirmed,
        { sql: 'r.check_in <= ?::date', params: [today] },
        { sql: 'r.check_out > ?::date', params: [today] },
      ];
    case CampaignStayFilter.UPCOMING:
      return [confirmed, { sql: 'r.check_in > ?::date', params: [today] }];
    case CampaignStayFilter.FINISHED:
      return [confirmed, { sql: 'r.check_out <= ?::date', params: [today] }];
    case CampaignStayFilter.UNPAID:
      // Venció sin pago: el cron la cancela sin cancelled_at (que solo pone la cancelación del huésped).
      return [
        {
          sql: `r.mp_payment_id IS NULL AND (r.status = ? OR (r.status = ? AND r.cancelled_at IS NULL))`,
          params: [
            ReservationStatus.PENDING_PAYMENT,
            ReservationStatus.CANCELLED,
          ],
        },
      ];
    default:
      return [];
  }
}

/** Columna que acota el rango de fechas: el check-in para las próximas y el check-out para las finalizadas. */
function rangeColumn(stayFilter: CampaignStayFilter | null): string | null {
  if (stayFilter === CampaignStayFilter.UPCOMING) return 'r.check_in';
  if (stayFilter === CampaignStayFilter.FINISHED) return 'r.check_out';
  return null;
}

/**
 * Personas de la reserva `r`. Las anteriores a `guest_count` (o cargadas por scripts) no lo
 * tienen: para no dejarlas afuera de todo filtro se usa la capacidad de la categoría de la
 * habitación, que es el tope de personas que admitía. Es una aproximación solo para esas.
 */
const GUESTS = `COALESCE(r.guest_count, (
  SELECT rc.capacity FROM rooms ro
  JOIN room_categories rc ON rc.id = ro.category_id
  WHERE ro.id = r.room_id
))`;

/**
 * Todas las condiciones de estadía van en un mismo EXISTS: la reserva que cumple el estado tiene
 * que ser la misma que cae en el rango de fechas y la que tiene esa cantidad de personas.
 */
function reservationCondition(
  filter: Required<RecipientFilter>,
  today: string,
): SqlClause | null {
  const conditions = stayConditions(filter.stayFilter, today);

  const column = rangeColumn(filter.stayFilter);
  if (column && filter.stayFrom)
    conditions.push({ sql: `${column} >= ?::date`, params: [filter.stayFrom] });
  if (column && filter.stayTo)
    conditions.push({ sql: `${column} <= ?::date`, params: [filter.stayTo] });

  if (filter.minGuests != null)
    conditions.push({ sql: `${GUESTS} >= ?`, params: [filter.minGuests] });
  if (filter.maxGuests != null)
    conditions.push({ sql: `${GUESTS} <= ?`, params: [filter.maxGuests] });

  if (conditions.length === 0) return null;
  return {
    sql: `EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.telegram_user_id = cs.telegram_user_id
        AND ${conditions.map((condition) => condition.sql).join(' AND ')}
    )`,
    params: conditions.flatMap((condition) => condition.params),
  };
}

/**
 * Check-in pedido en la búsqueda `bp`: el bot lo guarda como texto DD-MM-YYYY. El CASE evita que
 * un valor con otro formato rompa toda la consulta (queda en null y no cumple el rango).
 */
const QUOTED_CHECK_IN = `CASE WHEN bp.check_in ~ '^[0-9]{2}-[0-9]{2}-[0-9]{4}$'
  THEN to_date(bp.check_in, 'DD-MM-YYYY') END`;

/**
 * Consultaron disponibilidad y nunca reservaron: al menos una búsqueda del bot (con fechas y
 * personas) que cumpla el rango y la cantidad de personas, y ninguna reserva en ningún estado.
 * Los que reservaron sin pagar ya tienen su propio estado (UNPAID).
 */
function quotedCondition(filter: Required<RecipientFilter>): SqlClause {
  const conditions: SqlClause[] = [
    { sql: 'bp.capacity IS NOT NULL', params: [] },
  ];
  if (filter.stayFrom)
    conditions.push({
      sql: `${QUOTED_CHECK_IN} >= ?::date`,
      params: [filter.stayFrom],
    });
  if (filter.stayTo)
    conditions.push({
      sql: `${QUOTED_CHECK_IN} <= ?::date`,
      params: [filter.stayTo],
    });
  if (filter.minGuests != null)
    conditions.push({ sql: 'bp.capacity >= ?', params: [filter.minGuests] });
  if (filter.maxGuests != null)
    conditions.push({ sql: 'bp.capacity <= ?', params: [filter.maxGuests] });

  return {
    sql: `EXISTS (
      SELECT 1 FROM booking_processes bp
      WHERE bp.telegram_user_id = cs.telegram_user_id
        AND ${conditions.map((condition) => condition.sql).join(' AND ')}
    ) AND NOT EXISTS (
      SELECT 1 FROM reservations r WHERE r.telegram_user_id = cs.telegram_user_id
    )`,
    params: conditions.flatMap((condition) => condition.params),
  };
}

function stayCondition(
  filter: Required<RecipientFilter>,
  today: string,
): SqlClause | null {
  return filter.stayFilter === CampaignStayFilter.QUOTED
    ? quotedCondition(filter)
    : reservationCondition(filter, today);
}

function recipientsWhere(
  filter: Required<RecipientFilter>,
  today: string,
): SqlClause {
  const conditions = [
    audienceCondition(filter.audience),
    stayCondition(filter, today),
  ].filter((condition): condition is SqlClause => condition !== null);

  if (conditions.length === 0) return { sql: '', params: [] };
  return {
    sql: `WHERE ${conditions.map((condition) => condition.sql).join(' AND ')}`,
    params: conditions.flatMap((condition) => condition.params),
  };
}

@Injectable()
export class CampaignRepository {
  constructor(private readonly em: EntityManager) {}

  async countRecipients(
    filter: Required<RecipientFilter>,
    today: string,
  ): Promise<number> {
    const { sql: where, params } = recipientsWhere(filter, today);
    const [row] = await this.em
      .getConnection()
      .execute<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM chat_sessions cs ${where}`,
        params,
      );
    return Number(row?.count ?? 0);
  }

  async findRecipients(
    filter: Required<RecipientFilter>,
    today: string,
  ): Promise<string[]> {
    const { sql: where, params } = recipientsWhere(filter, today);
    const rows = await this.em
      .getConnection()
      .execute<{ telegram_user_id: string }[]>(
        `SELECT cs.telegram_user_id FROM chat_sessions cs ${where} ORDER BY cs.created_at, cs.id`,
        params,
      );
    return rows.map((row) => row.telegram_user_id);
  }

  async hasCampaignInProgress(): Promise<boolean> {
    return (
      (await this.em.count(Campaign, { status: CampaignStatus.SENDING })) > 0
    );
  }

  async insert(data: NewCampaign): Promise<Campaign> {
    const campaign = this.em.create(Campaign, {
      title: data.title,
      message: data.message,
      ...data.filter,
      hasImage: data.hasImage,
      totalRecipients: data.totalRecipients,
      createdBy: this.em.getReference(User, data.createdById),
    });
    await this.em.persist(campaign).flush();
    await this.em.populate(campaign, ['createdBy']);
    return campaign;
  }

  async findPage(
    page: number,
    pageSize: number,
  ): Promise<{ items: Campaign[]; total: number }> {
    const [items, total] = await this.em.findAndCount(
      Campaign,
      {},
      {
        populate: ['createdBy'],
        orderBy: { createdAt: 'desc', id: 'desc' },
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    );
    return { items, total };
  }

  async addProgress(id: string, progress: CampaignProgress): Promise<void> {
    await this.em.getConnection().execute(
      `UPDATE campaigns
       SET sent_count = sent_count + ?, failed_count = failed_count + ?,
           blocked_count = blocked_count + ?, updated_at = now()
       WHERE id = ?`,
      [progress.sent, progress.failed, progress.blocked, id],
    );
  }

  async finish(
    id: string,
    status: CampaignStatus,
    finishedAt: Date,
  ): Promise<void> {
    await this.em.nativeUpdate(
      Campaign,
      { id, status: CampaignStatus.SENDING },
      { status, finishedAt },
    );
  }

  async interruptUnfinished(finishedAt: Date): Promise<number> {
    return this.em.nativeUpdate(
      Campaign,
      { status: CampaignStatus.SENDING },
      { status: CampaignStatus.INTERRUPTED, finishedAt },
    );
  }
}
