import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';
import { UserRole } from '../../../infrastructure/database/entities/User.entity';

describe('RegisterDto', () => {
  const validPayload = {
    email: 'recepcion@omnidesk.local',
    password: 'unaClaveLarga123',
    fullName: 'Ana Recepción',
  };

  it('no arroja errores con datos válidos', async () => {
    const errors = await validate(plainToInstance(RegisterDto, validPayload));

    expect(errors).toHaveLength(0);
  });

  it('acepta un rol explícito válido', async () => {
    const errors = await validate(plainToInstance(RegisterDto, { ...validPayload, role: UserRole.ADMIN }));

    expect(errors).toHaveLength(0);
  });

  it('rechaza un rol inventado', async () => {
    const errors = await validate(plainToInstance(RegisterDto, { ...validPayload, role: 'SUPERADMIN' }));

    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('normaliza el email y recorta el nombre', async () => {
    const dto = plainToInstance(RegisterDto, {
      ...validPayload,
      email: '  Recepcion@OmniDesk.Local ',
      fullName: '  Ana Recepción  ',
    });

    expect(dto.email).toBe('recepcion@omnidesk.local');
    expect(dto.fullName).toBe('Ana Recepción');
  });

  it('rechaza una contraseña de menos de 8 caracteres', async () => {
    const errors = await validate(plainToInstance(RegisterDto, { ...validPayload, password: 'corta1' }));

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rechaza una contraseña de más de 72 caracteres, el límite real de bcrypt', async () => {
    const errors = await validate(plainToInstance(RegisterDto, { ...validPayload, password: 'a'.repeat(73) }));

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rechaza un nombre completo muy corto', async () => {
    const errors = await validate(plainToInstance(RegisterDto, { ...validPayload, fullName: 'Al' }));

    expect(errors.some((e) => e.property === 'fullName')).toBe(true);
  });
});
