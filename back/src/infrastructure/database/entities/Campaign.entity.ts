import { Opt } from '@mikro-orm/core';
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Enum,
  Index,
} from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { User } from './User.entity';
import { CustomBaseEntity } from './CustomBase.entity';

/** A quiénes va la campaña. CONFIRMED y NO_RESERVATION son complementarios: juntos son ALL. */
export enum CampaignAudience {
  /** Todos los que alguna vez le escribieron a Chamber. */
  ALL = 'ALL',
  /** Tienen al menos una reserva confirmada (de cualquier fecha). */
  CONFIRMED = 'CONFIRMED',
  /** Nunca confirmaron una reserva (incluye pagos pendientes y canceladas). */
  NO_RESERVATION = 'NO_RESERVATION',
}

export enum CampaignStatus {
  SENDING = 'SENDING',
  COMPLETED = 'COMPLETED',
  /** El servidor se reinició o el envío se cortó por un error inesperado. */
  INTERRUPTED = 'INTERRUPTED',
}

/**
 * Campaña masiva por Telegram (US-13). La imagen no se guarda: se manda una vez, Telegram
 * devuelve su file_id y el resto de los envíos reutilizan ese id. Acá solo queda constancia.
 */
@Entity({ tableName: 'campaigns' })
@Index({ properties: ['status'] })
export class Campaign extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @Property({ type: 'varchar', length: 100 })
  title!: string;

  @Property({ type: 'text' })
  message!: string;

  @Enum(() => CampaignAudience)
  audience!: CampaignAudience;

  @Property({ type: 'boolean' })
  hasImage: boolean & Opt = false;

  @Enum(() => CampaignStatus)
  status: CampaignStatus & Opt = CampaignStatus.SENDING;

  @Property({ type: 'integer' })
  totalRecipients!: number;

  @Property({ type: 'integer' })
  sentCount: number & Opt = 0;

  /** Todos los que no recibieron el mensaje, bloqueados incluidos. */
  @Property({ type: 'integer' })
  failedCount: number & Opt = 0;

  /** Subconjunto de `failedCount`: bloquearon al bot o borraron la cuenta. */
  @Property({ type: 'integer' })
  blockedCount: number & Opt = 0;

  // set null y no cascade: borrar un empleado no puede borrar el historial de campañas.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy?: User | null;

  @Property({ type: 'datetime', columnType: 'timestamp(6)', nullable: true })
  finishedAt?: Date;
}
