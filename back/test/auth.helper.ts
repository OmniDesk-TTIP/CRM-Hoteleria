import { INestApplication } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { JwtService } from '@nestjs/jwt';
import { hashPassword } from '../src/modules/auth/password.util';
import { JwtPayload } from '../src/modules/auth/auth.types';
import { User, UserRole } from '../src/infrastructure/database/entities/User.entity';

export interface SeededUser {
  user: User;
  password: string;
  /** Valor listo para el header: `Authorization: Bearer <token>`. */
  accessToken: string;
}

/**
 * Crea un usuario en la base de test y le firma un access token real, para que las suites
 * que pegan contra endpoints protegidos no tengan que pasar por /auth/login.
 * El email lleva sufijo único porque las suites comparten la misma base.
 */
export async function seedUser(
  app: INestApplication,
  em: EntityManager,
  role: UserRole = UserRole.ADMIN,
  password = 'unaClaveLarga123',
): Promise<SeededUser> {
  const email = `${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@omnidesk.test`;

  const user = em.create(User, {
    email,
    passwordHash: await hashPassword(password, 4),
    fullName: role === UserRole.ADMIN ? 'Admin E2E' : 'Empleado E2E',
    role,
  });

  em.persist(user);
  await em.flush();

  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
  const accessToken = await app.get(JwtService).signAsync(payload);

  return { user, password, accessToken };
}

export const bearer = (accessToken: string): string => `Bearer ${accessToken}`;
