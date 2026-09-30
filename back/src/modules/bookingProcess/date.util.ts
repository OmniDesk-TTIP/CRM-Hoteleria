export const DATE_FORMAT_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/;

export function parseDate(value: string): Date {
  const match = DATE_FORMAT_REGEX.exec(value);
  if (!match) throw new Error(`Fecha "${value}" no tiene el formato DD-MM-YYYY`);

  const [, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

export function isValidDateFormat(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = DATE_FORMAT_REGEX.exec(value);
  if (!match) return false;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
