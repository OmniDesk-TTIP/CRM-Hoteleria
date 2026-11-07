import { BadRequestException } from '@nestjs/common';

// Reglas compartidas por las galerías que se cargan desde el panel (restó, tipos de habitación).

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface PhotoContent {
  data: Buffer;
  mimeType: string;
}

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

/** Valida tamaño y tipo por contenido (no por extensión) y devuelve el mime detectado. */
export function assertValidPhoto(buffer: Buffer): string {
  if (buffer.length === 0)
    throw new BadRequestException('La imagen está vacía');
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new BadRequestException(
      `La imagen supera el tamaño máximo (${MAX_PHOTO_BYTES / 1024 / 1024} MB)`,
    );
  }

  const mimeType = detectImageType(buffer);
  if (!mimeType) {
    throw new BadRequestException('Solo se aceptan imágenes JPG, PNG o WebP');
  }
  return mimeType;
}

export function isSamePhotoSet(currentIds: string[], ids: string[]): boolean {
  if (ids.length !== currentIds.length) return false;
  const requested = new Set(ids);
  return (
    requested.size === ids.length && currentIds.every((id) => requested.has(id))
  );
}
