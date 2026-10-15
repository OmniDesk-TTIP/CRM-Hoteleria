import { Opt } from '@mikro-orm/core';
import {
  Check,
  Entity,
  Enum,
  OneToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';
import { Reservation } from './Reservation.entity';

export enum SatisfactionSurveyStatus {
  /** La invitación se creó y se está mandando por Telegram. */
  PENDING = 'PENDING',
  SENT = 'SENT',
  /** Telegram rechazó el mensaje (p. ej. el huésped bloqueó al bot). No se reintenta. */
  SEND_FAILED = 'SEND_FAILED',
  ANSWERED = 'ANSWERED',
}

/**
 * Encuesta de satisfacción post-estadía (US-18). Una fila por reserva: el OneToOne deja la FK
 * única, así que la invitación sale una sola vez (CA1) y no se admite una segunda respuesta
 * (CA3) aunque dos procesos lo intenten a la vez.
 *
 * El huésped entra con un token opaco que viaja solo en el link de Telegram; acá se guarda su
 * sha256 (mismo criterio que los refresh tokens). Las respuestas viven en la misma fila, junto a
 * la reserva y al chat del huésped (CA4).
 */
@Entity({ tableName: 'satisfaction_surveys' })
export class SatisfactionSurvey extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @OneToOne(() => Reservation, { owner: true, deleteRule: 'cascade' })
  reservation!: Reservation;

  /** Chat de Telegram al que se mandó la invitación. */
  @Property({ type: 'varchar' })
  telegramUserId!: string;

  @Property({ type: 'varchar' })
  @Unique()
  tokenHash!: string;

  @Enum(() => SatisfactionSurveyStatus)
  status: SatisfactionSurveyStatus & Opt = SatisfactionSurveyStatus.PENDING;

  @Property({ type: 'datetime' })
  expiresAt!: Date;

  @Property({ type: 'datetime', nullable: true })
  sentAt?: Date;

  @Property({ type: 'datetime', nullable: true })
  answeredAt?: Date;

  // Calificaciones de 1 a 5. Quedan en null hasta que el huésped responde.
  @Property({ type: 'smallint', nullable: true })
  @Check({ expression: 'overall_rating between 1 and 5' })
  overallRating?: number;

  @Property({ type: 'smallint', nullable: true })
  @Check({ expression: 'cleanliness_rating between 1 and 5' })
  cleanlinessRating?: number;

  @Property({ type: 'smallint', nullable: true })
  @Check({ expression: 'attention_rating between 1 and 5' })
  attentionRating?: number;

  @Property({ type: 'smallint', nullable: true })
  @Check({ expression: 'services_rating between 1 and 5' })
  servicesRating?: number;

  @Property({ type: 'text', nullable: true })
  comment?: string;

  /** El huésped autorizó que su reseña se muestre en la web del hotel. */
  @Property({ type: 'boolean' })
  publishConsent: boolean & Opt = false;

  /** Cuándo la publicó el administrador; null si no está publicada. */
  @Property({ type: 'datetime', nullable: true })
  publishedAt?: Date;
}
