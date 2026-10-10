import { Injectable } from '@nestjs/common';
import {
  FilterQuery,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  SatisfactionSurvey,
  SatisfactionSurveyStatus,
} from '../../infrastructure/database/entities/SatisfactionSurvey.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { toCalendarDayString } from '../spa/model/spa.model';
import {
  SatisfactionSurveyModel,
  SurveyAnswer,
} from './satisfactionSurvey.model';

/** Reserva terminada que todavía no recibió la encuesta. */
export interface InvitableReservation {
  reservationId: string;
  telegramUserId: string;
  guestFullName: string;
}

/** Límites del período en UTC: `from` incluido, `to` excluido. null = sin límite. */
export interface SurveyPeriod {
  from: Date | null;
  to: Date | null;
}

export interface SurveyAverages {
  responses: number;
  overall: number | null;
  cleanliness: number | null;
  attention: number | null;
  services: number | null;
}

/** Arma el WHERE de un período sobre una columna timestamptz. */
function periodClause(
  column: string,
  period: SurveyPeriod,
  params: unknown[],
): string {
  const clauses: string[] = [];
  if (period.from) {
    clauses.push(`${column} >= ?::timestamptz`);
    params.push(period.from.toISOString());
  }
  if (period.to) {
    clauses.push(`${column} < ?::timestamptz`);
    params.push(period.to.toISOString());
  }
  return clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '';
}

const toAverage = (value: string | null): number | null =>
  value === null ? null : Math.round(Number(value) * 100) / 100;

@Injectable()
export class SatisfactionSurveyRepository {
  constructor(private readonly em: EntityManager) {}

  /**
   * Reservas confirmadas cuyo checkout cae en [fromDay, toDay] (YYYY-MM-DD), con chat de Telegram
   * y sin encuesta. Las cargadas a mano sin Telegram quedan afuera: no hay a quién escribirle.
   */
  async findReservationsToInvite(
    fromDay: string,
    toDay: string,
    limit: number,
  ): Promise<InvitableReservation[]> {
    const rows = await this.em.getConnection().execute<
      {
        id: string;
        telegram_user_id: string;
        guest_full_name: string;
      }[]
    >(
      `
      SELECT r.id, r.telegram_user_id, r.guest_full_name
      FROM reservations r
      WHERE r.status = ?
        AND r.telegram_user_id IS NOT NULL
        AND r.check_out BETWEEN ?::date AND ?::date
        AND NOT EXISTS (
          SELECT 1 FROM satisfaction_surveys s WHERE s.reservation_id = r.id
        )
      ORDER BY r.check_out, r.id
      LIMIT ?
      `,
      [ReservationStatus.CONFIRMED, fromDay, toDay, limit],
    );

    return rows.map((row) => ({
      reservationId: row.id,
      telegramUserId: row.telegram_user_id,
      guestFullName: row.guest_full_name,
    }));
  }

  /**
   * Guarda la invitación antes de mandarla. La FK única a la reserva hace de candado: si otro
   * proceso ya la creó, devuelve false y la invitación no sale dos veces (CA1).
   */
  async createInvitation(
    survey: SatisfactionSurveyModel,
    tokenHash: string,
  ): Promise<boolean> {
    try {
      await this.em.fork().insert(SatisfactionSurvey, {
        id: survey.id,
        reservation: survey.reservationId,
        telegramUserId: survey.telegramUserId,
        tokenHash,
        status: survey.status,
        expiresAt: survey.expiresAt,
      });
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) return false;
      throw error;
    }
  }

  async markSent(id: string, sentAt: Date): Promise<void> {
    await this.em.nativeUpdate(
      SatisfactionSurvey,
      { id, status: SatisfactionSurveyStatus.PENDING },
      { status: SatisfactionSurveyStatus.SENT, sentAt },
    );
  }

  async markSendFailed(id: string): Promise<void> {
    await this.em.nativeUpdate(
      SatisfactionSurvey,
      { id, status: SatisfactionSurveyStatus.PENDING },
      { status: SatisfactionSurveyStatus.SEND_FAILED },
    );
  }

  async findById(id: string): Promise<SatisfactionSurveyModel | null> {
    return this.findOne({ id });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<SatisfactionSurveyModel | null> {
    return this.findOne({ tokenHash });
  }

  /**
   * Guarda la respuesta solo si la encuesta sigue abierta. El UPDATE condicional es atómico: si
   * llegan dos envíos a la vez, uno solo recibe true (CA3).
   */
  async answerIfOpen(
    id: string,
    answer: SurveyAnswer,
    now: Date,
  ): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      SatisfactionSurvey,
      {
        id,
        status: { $ne: SatisfactionSurveyStatus.ANSWERED },
        expiresAt: { $gt: now },
      },
      {
        status: SatisfactionSurveyStatus.ANSWERED,
        answeredAt: now,
        overallRating: answer.overallRating,
        cleanlinessRating: answer.cleanlinessRating,
        attentionRating: answer.attentionRating,
        servicesRating: answer.servicesRating,
        comment: answer.comment ?? undefined,
        publishConsent: answer.publishConsent,
      },
    );
    return affected === 1;
  }

  async updatePublication(model: SatisfactionSurveyModel): Promise<void> {
    await this.em.nativeUpdate(
      SatisfactionSurvey,
      { id: model.id },
      { publishedAt: model.publishedAt },
    );
  }

  /** Encuestas respondidas en el período, de la más reciente a la más vieja. */
  async findAnsweredPaginated(
    period: SurveyPeriod,
    page: number,
    pageSize: number,
  ): Promise<{ items: SatisfactionSurveyModel[]; total: number }> {
    const answeredAt: Record<string, Date> = {};
    if (period.from) answeredAt.$gte = period.from;
    if (period.to) answeredAt.$lt = period.to;

    const where: FilterQuery<SatisfactionSurvey> = {
      status: SatisfactionSurveyStatus.ANSWERED,
      ...(Object.keys(answeredAt).length > 0 ? { answeredAt } : {}),
    };

    const [entities, total] = await this.em.findAndCount(
      SatisfactionSurvey,
      where,
      {
        populate: ['reservation.room'],
        orderBy: { answeredAt: 'desc', id: 'asc' },
        limit: pageSize,
        offset: (page - 1) * pageSize,
      },
    );

    return { items: entities.map((entity) => this.toModel(entity)), total };
  }

  /** Cantidad de respuestas y promedio de cada calificación en el período (CA5). */
  async averages(period: SurveyPeriod): Promise<SurveyAverages> {
    const params: unknown[] = [SatisfactionSurveyStatus.ANSWERED];
    const where = `status = ?${periodClause('answered_at', period, params)}`;

    const [row] = await this.em.getConnection().execute<
      {
        responses: string;
        overall: string | null;
        cleanliness: string | null;
        attention: string | null;
        services: string | null;
      }[]
    >(
      `
      SELECT COUNT(*) AS responses,
             AVG(overall_rating) AS overall,
             AVG(cleanliness_rating) AS cleanliness,
             AVG(attention_rating) AS attention,
             AVG(services_rating) AS services
      FROM satisfaction_surveys
      WHERE ${where}
      `,
      params,
    );

    return {
      responses: Number(row.responses),
      overall: toAverage(row.overall),
      cleanliness: toAverage(row.cleanliness),
      attention: toAverage(row.attention),
      services: toAverage(row.services),
    };
  }

  /** Invitaciones enviadas en el período y cuántas de esas ya se respondieron. */
  async invitationCounts(
    period: SurveyPeriod,
  ): Promise<{ sent: number; answered: number }> {
    const params: unknown[] = [SatisfactionSurveyStatus.ANSWERED];
    const where = `sent_at IS NOT NULL${periodClause('sent_at', period, params)}`;

    const [row] = await this.em
      .getConnection()
      .execute<{ sent: string; answered: string }[]>(
        `
      SELECT COUNT(*) AS sent,
             COUNT(*) FILTER (WHERE status = ?) AS answered
      FROM satisfaction_surveys
      WHERE ${where}
      `,
        params,
      );

    return { sent: Number(row.sent), answered: Number(row.answered) };
  }

  private async findOne(
    where: FilterQuery<SatisfactionSurvey>,
  ): Promise<SatisfactionSurveyModel | null> {
    const entity = await this.em.findOne(SatisfactionSurvey, where, {
      populate: ['reservation.room'],
    });
    return entity ? this.toModel(entity) : null;
  }

  private toModel(entity: SatisfactionSurvey): SatisfactionSurveyModel {
    const {
      reservation,
      overallRating,
      cleanlinessRating,
      attentionRating,
      servicesRating,
    } = entity;
    // Sin el `& Opt` de MikroORM, para poder comparar contra el enum.
    const status: SatisfactionSurveyStatus = entity.status;
    const answer: SurveyAnswer | null =
      status === SatisfactionSurveyStatus.ANSWERED &&
      overallRating != null &&
      cleanlinessRating != null &&
      attentionRating != null &&
      servicesRating != null
        ? {
            overallRating,
            cleanlinessRating,
            attentionRating,
            servicesRating,
            comment: entity.comment ?? null,
            publishConsent: entity.publishConsent,
          }
        : null;

    return new SatisfactionSurveyModel({
      id: entity.id,
      reservationId: reservation.id,
      telegramUserId: entity.telegramUserId,
      status,
      expiresAt: entity.expiresAt,
      sentAt: entity.sentAt ?? null,
      answeredAt: entity.answeredAt ?? null,
      answer,
      publishedAt: entity.publishedAt ?? null,
      stay: {
        guestFullName: reservation.guestFullName,
        checkIn: toCalendarDayString(reservation.checkIn),
        checkOut: toCalendarDayString(reservation.checkOut),
        roomNumber: reservation.room?.roomNumber ?? null,
      },
    });
  }
}
