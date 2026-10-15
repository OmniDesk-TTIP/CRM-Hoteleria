export const MAX_RATING = 5;

/** 4.5 → "4,5". Los promedios llegan con dos decimales; en pantalla alcanza uno. */
export const formatRating = (value: number): string =>
  value.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
