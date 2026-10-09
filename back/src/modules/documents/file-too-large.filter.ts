import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MAX_UPLOAD_BYTES } from './documents.constants';

@Catch(PayloadTooLargeException)
export class FileTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(413)
      .json({
        statusCode: 413,
        error: 'Payload Too Large',
        message: `El archivo supera el tamaño máximo permitido (${MAX_UPLOAD_BYTES / 1024 / 1024} MB)`,
      });
  }
}
