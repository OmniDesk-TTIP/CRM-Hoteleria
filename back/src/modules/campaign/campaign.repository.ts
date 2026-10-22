import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import {
  Campaign,
  CampaignAudience,
  CampaignStatus,
} from '../../infrastructure/database/entities/Campaign.entity';
import { ReservationStatus } from '../../infrastructure/database/entities/Reservation.entity';
import { User } from '../../infrastructure/database/entities/User.entity';

export interface NewCampaign {
  title: string;
  message: string;
  audience: CampaignAudience;
  hasImage: boolean;
  totalRecipients: number;
  createdById: string;
}

export interface CampaignProgress {
  sent: number;
  failed: number;
  blocked: number;
}

const CONFIRMED_RESERVATION = `EXISTS (
  SELECT 1 FROM reservations r
  WHERE r.telegram_user_id = cs.telegram_user_id AND r.status = ?
)`;

/** Los contactos son las conversaciones con Chamber: una por usuario de Telegram. */
function audienceClause(audience: CampaignAudience): {
  where: string;
  params: unknown[];
} {
  switch (audience) {
    case CampaignAudience.CONFIRMED:
      return {
        where: `WHERE ${CONFIRMED_RESERVATION}`,
        params: [ReservationStatus.CONFIRMED],
      };
    case CampaignAudience.NO_RESERVATION:
      return {
        where: `WHERE NOT ${CONFIRMED_RESERVATION}`,
        params: [ReservationStatus.CONFIRMED],
      };
    default:
      return { where: '', params: [] };
  }
}

@Injectable()
export class CampaignRepository {
  constructor(private readonly em: EntityManager) {}

  async countRecipients(audience: CampaignAudience): Promise<number> {
    const { where, params } = audienceClause(audience);
    const [row] = await this.em
      .getConnection()
      .execute<{ count: string }[]>(
        `SELECT COUNT(*) AS count FROM chat_sessions cs ${where}`,
        params,
      );
    return Number(row?.count ?? 0);
  }

  async findRecipients(audience: CampaignAudience): Promise<string[]> {
    const { where, params } = audienceClause(audience);
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
      audience: data.audience,
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

  /** Suma en la base y no en memoria: el panel lee el progreso mientras el envío sigue. */
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

  /** Las que quedaron "enviando" de una corrida anterior del servidor ya no van a terminar. */
  async interruptUnfinished(finishedAt: Date): Promise<number> {
    return this.em.nativeUpdate(
      Campaign,
      { status: CampaignStatus.SENDING },
      { status: CampaignStatus.INTERRUPTED, finishedAt },
    );
  }
}
