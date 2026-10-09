import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DocumentsService } from './documents.service';
import { DocumentResponseDto } from './dto/documentResponse.dto';
import { RolesGuard } from '../auth/auth.guard';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { AuthUser } from '../auth/auth.types';
import { MAX_UPLOAD_BYTES } from './documents.constants';
import { decodeFilename } from './documents.util';
import { FileTooLargeFilter } from './file-too-large.filter';

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
