import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash, randomBytes } from 'crypto';
import { AuthRepository } from './auth.repository';
import { User } from '../../infrastructure/database/entities/User.entity';
import { AuthTokens, JwtPayload } from './auth.types';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly expiresIn: string;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authRepository: AuthRepository,
  ) {
    this.expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '15m';
    this.refreshTtlDays = Number(this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 7);
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private signAccessToken(user: User): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.signAsync(payload);
  }

  private refreshExpiryDate(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }

  async issueTokens(user: User): Promise<AuthTokens> {
    const refreshToken = randomBytes(32).toString('base64url');

    await this.authRepository.createRefreshToken(user, this.hashRefreshToken(refreshToken), this.refreshExpiryDate());

    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
      expiresIn: this.expiresIn,
    };
  }
  
  async rotate(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    const stored = await this.authRepository.findRefreshToken(tokenHash);

    if (!stored) {
      throw new UnauthorizedException('La sesión no es válida');
    }

    if (stored.revokedAt) {
      this.logger.warn(`Refresh token reusado del usuario ${stored.user.id}; se cierran todas sus sesiones`);
      await this.authRepository.revokeAllForUser(stored.user.id);
      throw new UnauthorizedException('La sesión no es válida');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('La sesión expiró');
    }

    if (!stored.user.isActive) {
      await this.authRepository.revokeAllForUser(stored.user.id);
      throw new UnauthorizedException('La sesión no es válida');
    }

    const newRefreshToken = randomBytes(32).toString('base64url');
    const newHash = this.hashRefreshToken(newRefreshToken);

    // Si el UPDATE condicional no afecta ninguna fila, otro request ya rotó este token.
    const revoked = await this.authRepository.revokeToken(tokenHash, newHash);
    if (!revoked) {
      throw new UnauthorizedException('La sesión no es válida');
    }

    await this.authRepository.createRefreshToken(stored.user, newHash, this.refreshExpiryDate());

    return {
      accessToken: await this.signAccessToken(stored.user),
      refreshToken: newRefreshToken,
      expiresIn: this.expiresIn,
    };
  }

  /** Cierra solo la sesión de ese token; las demás del usuario siguen abiertas. */
  async revoke(refreshToken: string): Promise<void> {
    await this.authRepository.revokeToken(this.hashRefreshToken(refreshToken));
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async purgeExpiredTokens(): Promise<void> {
    const deleted = await this.authRepository.deleteExpiredTokens(new Date());

    if (deleted > 0) {
      this.logger.log(`Se eliminaron ${deleted} refresh tokens vencidos`);
    }
  }
}
