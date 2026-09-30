import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from './login.dto';

describe('LoginDto', () => {
  const validPayload = { email: 'ana@omnidesk.local', password: 'unaClaveLarga123' };

  it('no arroja errores con datos válidos', async () => {
    const errors = await validate(plainToInstance(LoginDto, validPayload));

    expect(errors).toHaveLength(0);
  });

  it('normaliza el email a minúsculas y sin espacios', async () => {
    const dto = plainToInstance(LoginDto, { ...validPayload, email: '  Ana@OmniDesk.Local  ' });

    expect(dto.email).toBe('ana@omnidesk.local');
  });

  it('rechaza un email mal formado', async () => {
    const errors = await validate(plainToInstance(LoginDto, { ...validPayload, email: 'no-es-un-email' }));

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rechaza una contraseña vacía', async () => {
    const errors = await validate(plainToInstance(LoginDto, { ...validPayload, password: '' }));

    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('acepta una contraseña corta: el largo mínimo es regla del registro, no del login', async () => {
    const errors = await validate(plainToInstance(LoginDto, { ...validPayload, password: 'abc' }));

    expect(errors).toHaveLength(0);
  });
});
