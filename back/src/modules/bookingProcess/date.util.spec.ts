import { formatDate, isValidDateFormat, parseDate } from './date.util';

describe('date.util', () => {
  describe('parseDate', () => {
    it('parsea una fecha válida en formato DD-MM-YYYY', () => {
      const date = parseDate('15-03-2026');

      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(2);
      expect(date.getDate()).toBe(15);
    });

    it('lanza un error si el formato no es DD-MM-YYYY', () => {
      expect(() => parseDate('2026-03-15')).toThrow('Fecha "2026-03-15" no tiene el formato DD-MM-YYYY');
    });

    it('lanza un error si el valor no tiene forma de fecha', () => {
      expect(() => parseDate('mañana')).toThrow('no tiene el formato DD-MM-YYYY');
    });
  });

  describe('formatDate', () => {
    it('formatea una fecha con día y mes de un dígito con cero a la izquierda', () => {
      expect(formatDate(new Date(2026, 0, 5))).toBe('05-01-2026');
    });

    it('formatea una fecha con día y mes de dos dígitos', () => {
      expect(formatDate(new Date(2026, 10, 25))).toBe('25-11-2026');
    });
  });

  describe('isValidDateFormat', () => {
    it('acepta una fecha válida en formato DD-MM-YYYY', () => {
      expect(isValidDateFormat('01-11-2026')).toBe(true);
    });

    it('rechaza un valor que no sea string', () => {
      expect(isValidDateFormat(20261101)).toBe(false);
      expect(isValidDateFormat(null)).toBe(false);
      expect(isValidDateFormat(undefined)).toBe(false);
    });

    it('rechaza un formato incorrecto', () => {
      expect(isValidDateFormat('2026-11-01')).toBe(false);
      expect(isValidDateFormat('1-11-2026')).toBe(false);
    });

    it('rechaza fechas calendario inválidas (ej. 31 de febrero)', () => {
      expect(isValidDateFormat('31-02-2026')).toBe(false);
    });

    it('rechaza el 29 de febrero en un año no bisiesto', () => {
      expect(isValidDateFormat('29-02-2025')).toBe(false);
    });

    it('acepta el 29 de febrero en un año bisiesto', () => {
      expect(isValidDateFormat('29-02-2028')).toBe(true);
    });
  });
});
