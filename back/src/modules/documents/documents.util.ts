/**
 * Multer decodifica el nombre del archivo como latin1, así que "Políticas.pdf" llega como
 * "Polí­ticas.pdf". Si el nombre ya viene bien (UTF-8 real) se devuelve tal cual.
 */
export const decodeFilename = (name: string): string => {
  // Un carácter fuera de latin1 (emoji, "—", "€") significa que el nombre ya es UTF-8 real.
  if ([...name].some((c) => c.charCodeAt(0) > 0xff)) return name;

  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  // Si no era UTF-8 mal decodificado, los bytes no forman UTF-8 válido y aparece U+FFFD.
  return decoded.includes('\uFFFD') ? name : decoded;
};
