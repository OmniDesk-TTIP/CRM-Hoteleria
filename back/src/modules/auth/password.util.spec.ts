import { burnPasswordComparison, hashPassword, verifyPassword } from './password.util';

describe('password.util', () => {
  it('genera un hash distinto del texto plano y lo verifica', async () => {
    const hash = await hashPassword('unaClaveLarga123', 4);

    expect(hash).not.toBe('unaClaveLarga123');
    await expect(verifyPassword('unaClaveLarga123', hash)).resolves.toBe(true);
  });

  it('rechaza una contraseña incorrecta', async () => {
    const hash = await hashPassword('unaClaveLarga123', 4);

    await expect(verifyPassword('otraClave', hash)).resolves.toBe(false);
  });

  it('genera hashes distintos para la misma contraseña (salt aleatorio)', async () => {
    const [a, b] = await Promise.all([hashPassword('misma', 4), hashPassword('misma', 4)]);

    expect(a).not.toBe(b);
  });

  it('la comparación de descarte no arroja y usa un hash bcrypt válido', async () => {
    // Si el hash dummy estuviera mal formado, compare() cortaría enseguida y no serviría
    // para igualar los tiempos entre un email que existe y uno que no.
    const start = Date.now();
    await expect(burnPasswordComparison('cualquier-cosa')).resolves.toBeUndefined();

    expect(Date.now() - start).toBeGreaterThan(0);
  });
});
