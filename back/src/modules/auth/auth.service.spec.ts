import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { TokenService } from './token.service';
import { hashPassword } from './password.util';
import { User, UserRole } from '../../infrastructure/database/entities/User.entity';

const SALT_ROUNDS = 4; // bajo a propósito: los tests no necesitan el costo real

describe('AuthService', () => {
  let service: AuthService;
  let authRepositoryMock: {
    findUserByEmail: jest.Mock;
    findUserById: jest.Mock;
    createUser: jest.Mock;
    touchLastLogin: jest.Mock;
  };
  let tokenServiceMock: { issueTokens: jest.Mock; rotate: jest.Mock; revoke: jest.Mock };

  const buildUser = async (overrides: Partial<User> = {}): Promise<User> =>
    ({
      id: 'user-1',
      email: 'ana@omnidesk.local',
      passwordHash: await hashPassword('unaClaveLarga123', SALT_ROUNDS),
      fullName: 'Ana Recepción',
      role: UserRole.EMPLOYEE,
      isActive: true,
      createdAt: new Date('2026-01-01'),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    authRepositoryMock = {
      findUserByEmail: jest.fn(),
      findUserById: jest.fn(),
      createUser: jest.fn(),
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    tokenServiceMock = {
      issueTokens: jest.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresIn: '15m' }),
      rotate: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AuthRepository, useValue: authRepositoryMock },
        { provide: TokenService, useValue: tokenServiceMock },
        { provide: ConfigService, useValue: { get: jest.fn(() => String(SALT_ROUNDS)) } },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('guarda la contraseña hasheada y nunca la devuelve', async () => {
      authRepositoryMock.createUser.mockImplementation(async (data) => buildUser(data));

      const result = await service.register({
        email: 'nueva@omnidesk.local',
        password: 'unaClaveLarga123',
        fullName: 'Nueva Empleada',
      });

      const { passwordHash } = authRepositoryMock.createUser.mock.calls[0][0];
      expect(passwordHash).not.toBe('unaClaveLarga123');
      expect(Object.keys(result)).not.toContain('passwordHash');
    });

    it('usa EMPLOYEE cuando no se especifica el rol', async () => {
      authRepositoryMock.createUser.mockImplementation(async (data) => buildUser(data));

      await service.register({ email: 'nueva@omnidesk.local', password: 'unaClaveLarga123', fullName: 'Nueva' });

      expect(authRepositoryMock.createUser.mock.calls[0][0].role).toBe(UserRole.EMPLOYEE);
    });

    it('traduce la violación del índice único en un 409', async () => {
      authRepositoryMock.createUser.mockRejectedValue(
        new UniqueConstraintViolationException(new Error('duplicate key')),
      );

      await expect(
        service.register({ email: 'ana@omnidesk.local', password: 'unaClaveLarga123', fullName: 'Ana' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('devuelve los tokens y el usuario con credenciales válidas', async () => {
      authRepositoryMock.findUserByEmail.mockResolvedValue(await buildUser());

      const result = await service.login({ email: 'ana@omnidesk.local', password: 'unaClaveLarga123' });

      expect(result.accessToken).toBe('access');
      expect(result.refreshToken).toBe('refresh');
      expect(result.user.email).toBe('ana@omnidesk.local');
      expect(authRepositoryMock.touchLastLogin).toHaveBeenCalledWith('user-1');
    });

    it('no permite distinguir un email inexistente de una contraseña incorrecta', async () => {
      authRepositoryMock.findUserByEmail.mockResolvedValue(null);
      const inexistente = await service
        .login({ email: 'nadie@omnidesk.local', password: 'unaClaveLarga123' })
        .catch((e) => e);

      authRepositoryMock.findUserByEmail.mockResolvedValue(await buildUser());
      const claveMala = await service.login({ email: 'ana@omnidesk.local', password: 'incorrecta' }).catch((e) => e);

      expect(inexistente).toBeInstanceOf(UnauthorizedException);
      expect(claveMala).toBeInstanceOf(UnauthorizedException);
      expect(inexistente.message).toBe(claveMala.message);
    });

    it('rechaza a un usuario desactivado con el mismo mensaje genérico', async () => {
      authRepositoryMock.findUserByEmail.mockResolvedValue(await buildUser({ isActive: false }));

      await expect(service.login({ email: 'ana@omnidesk.local', password: 'unaClaveLarga123' })).rejects.toThrow(
        'Email o contraseña incorrectos',
      );
      expect(tokenServiceMock.issueTokens).not.toHaveBeenCalled();
    });
  });

  describe('refresh y logout', () => {
    it('rechaza el refresh cuando no llegó la cookie', async () => {
      await expect(service.refresh(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokenServiceMock.rotate).not.toHaveBeenCalled();
    });

    it('delega la rotación en el TokenService', async () => {
      tokenServiceMock.rotate.mockResolvedValue({ accessToken: 'nuevo', refreshToken: 'r2', expiresIn: '15m' });

      await expect(service.refresh('refresh-viejo')).resolves.toMatchObject({ accessToken: 'nuevo' });
      expect(tokenServiceMock.rotate).toHaveBeenCalledWith('refresh-viejo');
    });

    it('el logout sin cookie no explota ni revoca nada', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(tokenServiceMock.revoke).not.toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('rechaza a un usuario que fue desactivado después de emitir el token', async () => {
      authRepositoryMock.findUserById.mockResolvedValue(await buildUser({ isActive: false }));

      await expect(service.findById('user-1')).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
