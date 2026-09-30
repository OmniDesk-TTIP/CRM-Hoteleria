import { createValidationPipe } from '../../../validation.config';
import { ListChatsQueryDto } from './listChats.dto';

/**
 * El ValidationPipe global corre con whitelist + forbidNonWhitelisted, así que una propiedad
 * sin decorador de validación no solo se descarta: hace que el request entero devuelva 400.
 * Estos casos existen para que los filtros booleanos de la bandeja no se rompan en silencio.
 */
describe('ListChatsQueryDto', () => {
  const pipe = createValidationPipe();
  const metadata = { type: 'query' as const, metatype: ListChatsQueryDto, data: '' };

  const transform = (query: Record<string, unknown>) => pipe.transform(query, metadata);

  it('acepta los filtros booleanos que llegan como string', async () => {
    await expect(transform({ pendingHandover: 'true', assignedToMe: 'true' })).resolves.toMatchObject({
      pendingHandover: true,
      assignedToMe: true,
    });
  });

  it('trata cualquier otro valor como false', async () => {
    await expect(transform({ pendingHandover: 'false' })).resolves.toMatchObject({ pendingHandover: false });
  });

  it('aplica los valores por defecto de paginación', async () => {
    await expect(transform({})).resolves.toMatchObject({ page: 1, pageSize: 20, sortDir: 'desc' });
  });

  it('rechaza un estado inexistente', async () => {
    await expect(transform({ status: 'DORMIDO' })).rejects.toThrow();
  });

  it('rechaza una propiedad que no está en el DTO', async () => {
    await expect(transform({ inventado: '1' })).rejects.toThrow();
  });
});
