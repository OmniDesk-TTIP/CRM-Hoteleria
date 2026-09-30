import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/core';
import { User } from '../../infrastructure/database/entities/User.entity';
import { RefreshToken } from '../../infrastructure/database/entities/RefreshToken.entity';

@Injectable()
export class AuthRepository {
  constructor(private readonly em: EntityManager) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return this.em.findOne(User, { email }, { disableIdentityMap: true });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.em.findOne(User, { id }, { disableIdentityMap: true });
  }

  async countUsers(): Promise<number> {
    return this.em.count(User);
  }

  async createUser(data: Pick<User, 'email' | 'passwordHash' | 'fullName' | 'role'>): Promise<User> {
    const user = this.em.create(User, data);
    this.em.persist(user);
    await this.em.flush();
    return user;
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.em.nativeUpdate(User, { id: userId }, { lastLoginAt: new Date() });
  }

  async createRefreshToken(user: User, tokenHash: string, expiresAt: Date): Promise<RefreshToken> {
    const token = this.em.create(RefreshToken, { user, tokenHash, expiresAt });
    this.em.persist(token);
    await this.em.flush();
    return token;
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshToken | null> {
    return this.em.findOne(RefreshToken, { tokenHash }, { populate: ['user'], disableIdentityMap: true });
  }

  async revokeToken(tokenHash: string, replacedByHash?: string): Promise<boolean> {
    const affected = await this.em.nativeUpdate(
      RefreshToken,
      { tokenHash, revokedAt: null },
      { revokedAt: new Date(), replacedByHash },
    );

    return affected === 1;
  }
  
  async revokeAllForUser(userId: string): Promise<number> {
    return this.em.nativeUpdate(RefreshToken, { user: userId, revokedAt: null }, { revokedAt: new Date() });
  }

  async deleteExpiredTokens(now: Date): Promise<number> {
    return this.em.nativeDelete(RefreshToken, { expiresAt: { $lt: now } });
  }
}
