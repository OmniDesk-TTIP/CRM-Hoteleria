import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { RoomPhotoService } from './roomPhoto.service';
import { ReorderRoomPhotosDto, RoomPhotoDto } from './dto/roomPhoto.dto';
import { RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import {
  PhotoTooLargeFilter,
  PhotoUploadInterceptor,
} from '../../common/photo.http';

// Galería de cada tipo de habitación en el panel. Leer lo puede cualquier usuario del panel;
// cargar, ordenar y borrar, solo el administrador (igual que la galería del restó).
@Controller('rooms/categories/:categoryId/photos')
export class RoomPhotoController {
  constructor(private readonly photoService: RoomPhotoService) {}

  @Get()
  list(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ): Promise<RoomPhotoDto[]> {
    return this.photoService.list(categoryId);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @UseFilters(PhotoTooLargeFilter)
  @UseInterceptors(PhotoUploadInterceptor())
  upload(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RoomPhotoDto> {
    if (!file)
      throw new BadRequestException('Adjuntá una imagen JPG, PNG o WebP');
    return this.photoService.upload(categoryId, file.buffer);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Put('order')
  reorder(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: ReorderRoomPhotosDto,
  ): Promise<RoomPhotoDto[]> {
    return this.photoService.reorder(categoryId, body.ids);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.photoService.remove(categoryId, id);
  }
}
