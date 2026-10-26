import {
  ArgumentsHost,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { DocumentsService } from './documents.service';
import {
  DocumentResponseDto,
  MAX_UPLOAD_BYTES,
  decodeFilename,
} from './documents.model';
import { RolesGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { AuthUser } from '../auth/auth.types';

/** Multer corta con un 413 en inglés ("File too large"); acá se responde en español. */
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

@Controller('admin/documents')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(): Promise<DocumentResponseDto[]> {
    return this.documentsService.list();
  }

  @Post()
  @UseFilters(FileTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentResponseDto> {
    if (!file) throw new BadRequestException('Adjuntá un archivo PDF o TXT');
    return this.documentsService.upload(
      {
        originalname: decodeFilename(file.originalname),
        mimetype: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      user.id,
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.documentsService.remove(id);
  }
}
