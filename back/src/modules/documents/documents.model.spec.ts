import { decodeFilename } from './documents.model';

/**
 * Solo lo puro con casos borde que el e2e no recorre. Validación, guardado, procesamiento y baja
 * se prueban contra la base en documents.service.integration-spec.ts, y la subida por HTTP
 * (incluido que las tildes lleguen bien por multer) en test/documents.e2e-spec.ts.
 */
describe('decodeFilename', () => {
  it('corrige un nombre con tildes y ñ que multer decodificó como latin1', () => {
    const mojibake = Buffer.from(
      'Políticas de cancelación.pdf',
      'utf8',
    ).toString('latin1');

    expect(decodeFilename(mojibake)).toBe('Políticas de cancelación.pdf');
  });

  it('deja igual un nombre que no necesita corrección (ASCII o UTF-8 que ya viene bien)', () => {
    expect(decodeFilename('reglas.txt')).toBe('reglas.txt');
    expect(decodeFilename('Políticas.pdf')).toBe('Políticas.pdf');
  });

  it('no toca nombres con caracteres fuera de latin1 (emoji, guión largo)', () => {
    expect(decodeFilename('Reglas 🏨 — hotel.txt')).toBe(
      'Reglas 🏨 — hotel.txt',
    );
  });
});
