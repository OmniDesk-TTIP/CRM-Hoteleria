import { Entity, PrimaryKey, Property, ManyToOne, Unique } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { User } from './User.entity';
import { CustomBaseEntity } from './CustomBase.entity';

/**
 * Una fila por sesión abierta. El token que viaja al cliente es opaco y no se guarda:
 * solo queda su sha256, así que la base alcanza para saber si la sesión sigue viva
 * sin poder reconstruir el token original.
 */
@Entity({ tableName: 'refresh_tokens' })
export class RefreshToken extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property({ type: 'varchar' })
  @Unique()
  tokenHash!: string;

  @Property({ type: 'datetime' })
  expiresAt!: Date;

  @Property({ type: 'datetime', nullable: true })
  revokedAt?: Date;

  // Deja la cadena de rotación a la vista: sirve para auditar un reuso detectado.
  @Property({ type: 'varchar', nullable: true })
  replacedByHash?: string;
}
