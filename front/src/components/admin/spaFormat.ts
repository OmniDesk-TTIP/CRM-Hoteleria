/** Lunes primero, que es como se lee una agenda semanal en Argentina. */
export const WEEKDAY_OPTIONS: { value: number; short: string; long: string }[] = [
  { value: 1, short: 'Lun', long: 'lunes' },
  { value: 2, short: 'Mar', long: 'martes' },
  { value: 3, short: 'Mié', long: 'miércoles' },
  { value: 4, short: 'Jue', long: 'jueves' },
  { value: 5, short: 'Vie', long: 'viernes' },
  { value: 6, short: 'Sáb', long: 'sábado' },
  { value: 0, short: 'Dom', long: 'domingo' },
];

export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(Number(value));

export const describeWeekdays = (weekdays: number[]): string => {
  if (weekdays.length === 7) return 'Todos los días';
  return WEEKDAY_OPTIONS.filter((day) => weekdays.includes(day.value))
    .map((day) => day.short)
    .join(', ');
};

/** YYYY-MM-DD → DD/MM/YYYY sin pasar por Date, para no correr de día por la zona horaria. */
export const formatIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-');
  return `${day}/${month}/${year}`;
};
