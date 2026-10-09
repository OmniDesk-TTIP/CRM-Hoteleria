import { decodeFilename } from './documents.util';

describe('decodeFilename', () => {
  it('deja igual un nombre ASCII', () => {
    expect(decodeFilename('reglas-del-hotel.pdf')).toBe('reglas-del-hotel.pdf');
  });

  it('corrige un nombre con tildes y ñ que multer decodificó como latin1', () => {
    const original = 'Políticas de cancelación y año nuevo.pdf';
    const garbled = Buffer.from(original, 'utf8').toString('latin1');

    expect(garbled).not.toBe(original);
    expect(decodeFilename(garbled)).toBe(original);
  });

  it('no rompe un nombre que ya viene en UTF-8 correcto', () => {
    expect(decodeFilename('Políticas.pdf')).toBe('Políticas.pdf');
    expect(decodeFilename('año.txt')).toBe('año.txt');
    expect(decodeFilename('mañ')).toBe('mañ');
  });

  it('no toca nombres con caracteres fuera de latin1 (emoji, guión largo)', () => {
    expect(decodeFilename('Reglas — spa 🧖.txt')).toBe('Reglas — spa 🧖.txt');
  });
});
