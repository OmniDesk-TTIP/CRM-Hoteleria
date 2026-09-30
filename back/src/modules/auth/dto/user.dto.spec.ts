import { UserDto } from './user.dto';
import { User, UserRole } from '../../../infrastructure/database/entities/User.entity';

describe('UserDto', () => {
  const user = {
    id: 'user-1',
    email: 'ana@omnidesk.local',
    passwordHash: '$2b$10$hash-que-no-tiene-que-salir',
    fullName: 'Ana Recepción',
    role: UserRole.EMPLOYEE,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    lastLoginAt: new Date('2026-02-01'),
  } as User;

  it('expone solo los campos del contrato público', () => {
    const dto = UserDto.fromEntity(user);

    expect(Object.keys(dto).sort()).toEqual(['createdAt', 'email', 'fullName', 'id', 'isActive', 'role']);
  });

  it('nunca incluye el hash de la contraseña', () => {
    const dto = UserDto.fromEntity(user);

    expect(Object.keys(dto)).not.toContain('passwordHash');
    expect(JSON.stringify(dto)).not.toContain('hash-que-no-tiene-que-salir');
  });
});
