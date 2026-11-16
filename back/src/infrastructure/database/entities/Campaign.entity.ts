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

/**
 * Filtro opcional por la estadía, que se suma (AND) a `CampaignAudience`. Para entrar, el contacto
 * tiene que tener al menos una reserva (o búsqueda, en QUOTED) que cumpla el estado, el rango de
 * fechas y la cantidad de personas a la vez: no vale que cada condición la cumpla una distinta.
 */
export enum CampaignStayFilter {
  /** Reserva confirmada con check-in hoy o antes y check-out después de hoy. */
  IN_HOUSE = 'IN_HOUSE',
  /** Reserva confirmada con check-in después de hoy. El rango de fechas acota el check-in. */
  UPCOMING = 'UPCOMING',
  /** Reserva confirmada con check-out hoy o antes. El rango de fechas acota el check-out. */
  FINISHED = 'FINISHED',
  /** Pidieron la reserva por el bot y nunca pagaron la seña: sigue pendiente o venció sin pago. */
  UNPAID = 'UNPAID',
  /**
   * Le pidieron disponibilidad a Chamber (fechas y personas) y nunca hicieron una reserva. No mira
   * reservas sino búsquedas del bot: personas y rango de fechas se miden sobre la búsqueda.
   */
  QUOTED = 'QUOTED',
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

  @Enum({ items: () => CampaignStayFilter, nullable: true })
  stayFilter?: CampaignStayFilter | null;

  // YYYY-MM-DD, como las fechas de las promociones: son días de calendario del hotel, sin hora.
  @Property({ type: 'varchar', length: 10, nullable: true })
  stayFrom?: string | null;

  @Property({ type: 'varchar', length: 10, nullable: true })
  stayTo?: string | null;

  @Property({ type: 'integer', nullable: true })
  minGuests?: number | null;

  @Property({ type: 'integer', nullable: true })
  maxGuests?: number | null;

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
