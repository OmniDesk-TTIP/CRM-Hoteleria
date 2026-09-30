import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from './token.service';
import { AuthRepository } from './auth.repository';
import { User, UserRole } from '../../infrastructure/database/entities/User.entity';
import { RefreshToken } from '../../infrastructure/database/entities/RefreshToken.entity';

describe('TokenService', () => {
  let service: TokenService;
  let authRepositoryMock: {
    createRefreshToken: jest.Mock;
    findRefreshToken: jest.Mock;
    revokeToken: jest.Mock;
    revokeAllForUser: jest.Mock;
    deleteExpiredTokens: jest.Mock;
  };
  let jwtServiceMock: { signAsync: jest.Mock };

  const user = { id: 'user-1', email: 'ana@omnidesk.local', role: UserRole.EMPLOYEE, isActive: true } as User;

  const storedToken = (overrides: Partial<RefreshToken> = {}): RefreshToken =>
    ({
      id: 'token-1',
      user,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: undefined,
      ...overrides,
    }) as RefreshToken;

  const configValues: Record<string, string> = { JWT_EXPIRES_IN: '15m', REFRESH_TOKEN_TTL_DAYS: '7' };

  beforeEach(async () => {
    authRepositoryMock = {
      createRefreshToken: jest.fn().mockResolvedValue(undefined),
      findRefreshToken: jest.fn(),
      revokeToken: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(2),
      deleteExpiredTokens: jest.fn().mockResolvedValue(0),
    };
    jwtServiceMock = { signAsync: jest.fn().mockResolvedValue('access-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenService,
        { provide: AuthRepository, useValue: authRepositoryMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => configValues[key]) } },
      ],
    }).compile();

    service = module.get<TokenService>(TokenService);
  });

  describe('issueTokens', () => {
    it('firma el access token con sub, email y rol, y guarda solo el hash del refresh', async () => {
      const result = await service.issueTokens(user);

      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith({
        sub: 'user-1',
        email: 'ana@omnidesk.local',
        role: UserRole.EMPLOYEE,
      });

      const [, storedHash] = authRepositoryMock.createRefreshToken.mock.calls[0];
      expect(storedHash).toBe(service.hashRefreshToken(result.refreshToken));
      expect(storedHash).not.toBe(result.refreshToken);
    });

    it('genera un refresh token distinto en cada emisión', async () => {
      const [a, b] = [await service.issueTokens(user), await service.issueTokens(user)];

      expect(a.refreshToken).not.toBe(b.refreshToken);
    });
  });

  describe('rotate', () => {
    it('revoca el token viejo, encadena el nuevo y emite un par nuevo', async () => {
      authRepositoryMock.findRefreshToken.mockResolvedValue(storedToken());

      const result = await service.rotate('refresh-viejo');

      const [revokedHash, replacedByHash] = authRepositoryMock.revokeToken.mock.calls[0];
      expect(revokedHash).toBe(service.hashRefreshToken('refresh-viejo'));
      expect(replacedByHash).toBe(service.hashRefreshToken(result.refreshToken));
      expect(result.refreshToken).not.toBe('refresh-viejo');
    });

    it('ante un token ya revocado cierra todas las sesiones del usuario', async () => {
      authRepositoryMock.findRefreshToken.mockResolvedValue(storedToken({ revokedAt: new Date() }));

      await expect(service.rotate('refresh-robado')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authRepositoryMock.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('rechaza un token desconocido sin tocar nada', async () => {
      authRepositoryMock.findRefreshToken.mockResolvedValue(null);

      await expect(service.rotate('inventado')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authRepositoryMock.revokeAllForUser).not.toHaveBeenCalled();
      expect(authRepositoryMock.revokeToken).not.toHaveBeenCalled();
    });

    it('rechaza un token vencido', async () => {
      authRepositoryMock.findRefreshToken.mockResolvedValue(
        storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.rotate('vencido')).rejects.toThrow('La sesión expiró');
    });

    it('cierra las sesiones si el usuario fue desactivado', async () => {
      authRepositoryMock.findRefreshToken.mockResolvedValue(storedToken({ user: { ...user, isActive: false } as User }));

      await expect(service.rotate('refresh-viejo')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authRepositoryMock.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });

    it('rechaza si otro request ganó la carrera y ya revocó el token', async () => {
      authRepositoryMock.findRefreshToken.mockResolvedValue(storedToken());
      authRepositoryMock.revokeToken.mockResolvedValue(false);

      await expect(service.rotate('refresh-viejo')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(authRepositoryMock.createRefreshToken).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('revoca solo la sesión de ese token y no toca las demás', async () => {
      await service.revoke('refresh-de-esta-sesion');

      expect(authRepositoryMock.revokeToken).toHaveBeenCalledWith(service.hashRefreshToken('refresh-de-esta-sesion'));
      expect(authRepositoryMock.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('purgeExpiredTokens', () => {
    it('borra los tokens vencidos', async () => {
      authRepositoryMock.deleteExpiredTokens.mockResolvedValue(3);

      await service.purgeExpiredTokens();

      expect(authRepositoryMock.deleteExpiredTokens).toHaveBeenCalledTimes(1);
    });
  });
});
