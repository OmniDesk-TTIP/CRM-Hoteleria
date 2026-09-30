import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AuthSeederService } from './auth.seeder.service';
import { AuthRepository } from './auth.repository';
import { verifyPassword } from './password.util';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

describe('AuthSeederService', () => {
  let service: AuthSeederService;
  let authRepositoryMock: { countUsers: jest.Mock; createUser: jest.Mock };
  const originalNodeEnv = process.env.NODE_ENV;

  const configValues: Record<string, string | undefined> = {
    ADMIN_BOOTSTRAP_EMAIL: 'Admin@OmniDesk.Local',
    ADMIN_BOOTSTRAP_PASSWORD: 'unaClaveLarga123',
    BCRYPT_SALT_ROUNDS: '4',
  };

  const buildService = async (overrides: Record<string, string | undefined> = {}) => {
    const values = { ...configValues, ...overrides };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthSeederService,
        { provide: AuthRepository, useValue: authRepositoryMock },
        { provide: ConfigService, useValue: { get: jest.fn((key: string) => values[key]) } },
      ],
    }).compile();

    return module.get<AuthSeederService>(AuthSeederService);
  };

  beforeEach(async () => {
    process.env.NODE_ENV = 'dev';
    authRepositoryMock = { countUsers: jest.fn().mockResolvedValue(0), createUser: jest.fn() };
    service = await buildService();
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('crea el administrador inicial con la base vacía', async () => {
    await service.onModuleInit();

    const created = authRepositoryMock.createUser.mock.calls[0][0];
    expect(created.role).toBe(UserRole.ADMIN);
    expect(created.email).toBe('admin@omnidesk.local');
    await expect(verifyPassword('unaClaveLarga123', created.passwordHash)).resolves.toBe(true);
  });

  it('no siembra nada si ya hay usuarios', async () => {
    authRepositoryMock.countUsers.mockResolvedValue(3);

    await service.onModuleInit();

    expect(authRepositoryMock.createUser).not.toHaveBeenCalled();
  });

  it('no siembra nada durante los tests', async () => {
    process.env.NODE_ENV = 'test';

    await service.onModuleInit();

    expect(authRepositoryMock.countUsers).not.toHaveBeenCalled();
    expect(authRepositoryMock.createUser).not.toHaveBeenCalled();
  });

  it('no siembra si faltan las variables de bootstrap', async () => {
    service = await buildService({ ADMIN_BOOTSTRAP_PASSWORD: undefined });

    await service.onModuleInit();

    expect(authRepositoryMock.createUser).not.toHaveBeenCalled();
  });
});
