export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS = 20;

/** Prefijo de la ruta pública de las imágenes (ver RestaurantPublicController). */
export const PUBLIC_PHOTO_PATH = '/public/restaurant/photos';

export interface RestaurantPhotoProps {
  id: string;
  mimeType: string;
  sizeBytes: number;
  position: number;
}

/** Foto de la galería, sin los bytes: para listar y ordenar no hace falta cargarlos. */
export class RestaurantPhotoModel {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  position: number;

  constructor(props: RestaurantPhotoProps) {
    this.id = props.id;
    this.mimeType = props.mimeType;
    this.sizeBytes = props.sizeBytes;
    this.position = props.position;
  }

  publicPath(): string {
    return `${PUBLIC_PHOTO_PATH}/${this.id}`;
  }
}

/**
 * Tipo real de la imagen según sus primeros bytes. No se confía en el mimetype que manda el
 * navegador: la imagen se sirve en una ruta pública y no puede ser otra cosa (un HTML, un SVG con
 * scripts). Devuelve null si no es JPEG, PNG ni WebP.
 */
export function detectImageType(buffer: Buffer): string | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * ¿`ids` es exactamente la galería actual, reordenada? Un pedido de orden con fotos de menos, de
 * más o repetidas se rechaza en vez de aplicarse a medias.
 */
export function isSamePhotoSet(currentIds: string[], ids: string[]): boolean {
  if (ids.length !== currentIds.length) return false;
  const requested = new Set(ids);
  return (
    requested.size === ids.length && currentIds.every((id) => requested.has(id))
  );
}
