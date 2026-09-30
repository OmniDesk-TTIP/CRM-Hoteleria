import { Opt } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property, Enum, Unique } from '@mikro-orm/decorators/legacy';
import { v4 } from 'uuid';
import { CustomBaseEntity } from './CustomBase.entity';

export enum UserRole {
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
}

@Entity({ tableName: 'users' })
export class User extends CustomBaseEntity {
  @PrimaryKey({ type: 'uuid' })
  id: string = v4();

  // Siempre en minúsculas: los DTOs de entrada normalizan antes de llegar acá.
  @Property({ type: 'varchar' })
  @Unique()
  email!: string;

  // `hidden` saca el campo del toJSON de MikroORM, pero el contrato de salida real
  // es UserDto.fromEntity(); esto es solo la red de seguridad.
  @Property({ type: 'varchar', hidden: true })
  passwordHash!: string;

  @Property({ type: 'varchar' })
  fullName!: string;

  @Enum(() => UserRole)
  role: UserRole & Opt = UserRole.EMPLOYEE;

  @Property({ type: 'boolean' })
  isActive: boolean & Opt = true;

  @Property({ type: 'datetime', nullable: true })
  lastLoginAt?: Date;
}
