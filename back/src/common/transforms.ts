/** Helpers para `@Transform` de class-transformer: `value` llega sin tipar, así que se normaliza acá. */
type TransformParams = { value: unknown };

const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

/** Recorta espacios si es string; cualquier otro valor pasa tal cual para que lo rechace el validador. */
export const trimString = ({ value }: TransformParams) =>
  typeof value === 'string' ? value.trim() : value;

/** Convierte a string y recorta (acepta números, como los que llegan en query/body). */
export const toTrimmedString = ({ value }: TransformParams) =>
  isScalar(value) ? String(value).trim() : value;

export const toNormalizedEmail = ({ value }: TransformParams) =>
  isScalar(value) ? String(value).trim().toLowerCase() : value;
