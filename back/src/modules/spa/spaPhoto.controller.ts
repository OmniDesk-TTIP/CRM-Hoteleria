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
import { SpaPhotoService } from './spaPhoto.service';
import { ReorderSpaPhotosDto, SpaPhotoDto } from './dto/spaPhoto.dto';
import { RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import {
  PhotoTooLargeFilter,
  PhotoUploadInterceptor,
} from '../../common/photo.http';

// Galería del spa en el panel. Leer lo puede cualquier usuario del panel; cargar, ordenar y
// borrar, solo el administrador (igual que la galería del restó).
@Controller('spa/photos')
export class SpaPhotoController {
  constructor(private readonly photoService: SpaPhotoService) {}

  @Get()
  async list(): Promise<SpaPhotoDto[]> {
    const photos = await this.photoService.list();
    return photos.map((model) => SpaPhotoDto.fromModel(model));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post()
  @UseFilters(PhotoTooLargeFilter)
  @UseInterceptors(PhotoUploadInterceptor())
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SpaPhotoDto> {
    if (!file)
      throw new BadRequestException('Adjuntá una imagen JPG, PNG o WebP');
    return SpaPhotoDto.fromModel(await this.photoService.upload(file.buffer));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Put('order')
  async reorder(@Body() body: ReorderSpaPhotosDto): Promise<SpaPhotoDto[]> {
    const photos = await this.photoService.reorder(body.ids);
    return photos.map((model) => SpaPhotoDto.fromModel(model));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.photoService.remove(id);
  }
}
