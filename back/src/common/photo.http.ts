import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { MAX_PHOTO_BYTES, PhotoContent } from './photo.util';

@Catch(PayloadTooLargeException)
export class PhotoTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(413)
      .json({
        statusCode: 413,
        error: 'Payload Too Large',
        message: `La imagen supera el tamaño máximo (${MAX_PHOTO_BYTES / 1024 / 1024} MB)`,
      });
  }
}

/** Recibe el campo `file` del multipart en memoria, cortando en el tamaño máximo. */
export const PhotoUploadInterceptor = () =>
  FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES },
  });

export function sendPhoto(res: Response, { data, mimeType }: PhotoContent) {
  res
    .set({
      'Content-Type': mimeType,
      'Content-Length': String(data.length),
      // El id de una foto nunca cambia de contenido: el navegador la baja una sola vez.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      // La landing y el panel son otros orígenes: sin esto Chrome bloquea la imagen si algún
      // día se sirve con Cross-Origin-Embedder-Policy.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    })
    .send(data);
}
