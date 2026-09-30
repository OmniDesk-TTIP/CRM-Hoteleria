import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { JwtAuthGuard, RolesGuard } from './auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

const buildContext = (request: any, type = 'http'): ExecutionContext =>
  ({
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtServiceMock: { verifyAsync: jest.Mock };
  let reflectorMock: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    jwtServiceMock = { verifyAsync: jest.fn() };
    reflectorMock = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new JwtAuthGuard(jwtServiceMock as unknown as JwtService, reflectorMock as unknown as Reflector);
  });

  it('deja pasar una ruta @Public() sin mirar el token', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(buildContext({ headers: {} }))).resolves.toBe(true);
    expect(jwtServiceMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('no aplica a los handlers del bot de Telegram (contexto que no es HTTP)', async () => {
    await expect(guard.canActivate(buildContext(undefined, 'telegraf'))).resolves.toBe(true);
    expect(jwtServiceMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('rechaza cuando no hay header Authorization', async () => {
    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza un esquema que no sea Bearer', async () => {
    const context = buildContext({ headers: { authorization: 'Basic dXNlcjpwYXNz' } });

    await expect(guard.canActivate(context)).rejects.toThrow('No autenticado');
    expect(jwtServiceMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('rechaza un token inválido', async () => {
    jwtServiceMock.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(guard.canActivate(buildContext({ headers: { authorization: 'Bearer basura' } }))).rejects.toThrow(
      'Token inválido',
    );
  });

  it('distingue el token vencido para que el front sepa llamar a /auth/refresh', async () => {
    jwtServiceMock.verifyAsync.mockRejectedValue(new TokenExpiredError('jwt expired', new Date()));

    await expect(guard.canActivate(buildContext({ headers: { authorization: 'Bearer viejo' } }))).rejects.toThrow(
      'La sesión expiró',
    );
  });

  it('adjunta el usuario al request con un token válido', async () => {
    jwtServiceMock.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'ana@omnidesk.local',
      role: UserRole.EMPLOYEE,
    });
    const request: any = { headers: { authorization: 'Bearer valido' } };

    await expect(guard.canActivate(buildContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'ana@omnidesk.local', role: UserRole.EMPLOYEE });
  });
});

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflectorMock: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    reflectorMock = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflectorMock as unknown as Reflector);
  });

  it('deja pasar cuando el handler no declara roles', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext({ user: { role: UserRole.EMPLOYEE } }))).toBe(true);
  });

  it('rechaza con 403 a un rol insuficiente', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(buildContext({ user: { role: UserRole.EMPLOYEE } }))).toThrow(ForbiddenException);
  });

  it('deja pasar al rol requerido', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(guard.canActivate(buildContext({ user: { role: UserRole.ADMIN } }))).toBe(true);
  });

  it('rechaza si no hay usuario en el request', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    expect(() => guard.canActivate(buildContext({}))).toThrow(ForbiddenException);
  });
});
