import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RestaurantService } from './restaurant.service';
import { RestaurantPhotoService } from './restaurantPhoto.service';
import { UpdateRestaurantSettingsDto } from './dto/updateRestaurantSettings.dto';
import {
  CreateMenuItemDto,
  MenuItemDto,
  UpdateMenuItemDto,
} from './dto/menuItem.dto';
import {
  ReorderRestaurantPhotosDto,
  RestaurantPhotoDto,
  RestaurantSettingsDto,
} from './dto/restaurant.dto';
import { MAX_PHOTO_BYTES } from './model/restaurantPhoto.model';
import { RolesGuard } from '../auth/auth.guard';
import { Roles } from '../auth/auth.decorators';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

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

// Panel del restó (US-17 CA1/CA6). Leer lo puede cualquier usuario del panel; cargar y editar,
// solo el administrador (igual que los servicios de spa).
@Controller('restaurant')
export class RestaurantController {
  constructor(
    private readonly restaurantService: RestaurantService,
    private readonly photoService: RestaurantPhotoService,
  ) {}

  @Get()
  async getSettings(): Promise<RestaurantSettingsDto> {
    const { settings, configured } = await this.restaurantService.getSettings();
    return RestaurantSettingsDto.fromModel(settings, configured);
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Put()
  async updateSettings(
    @Body() body: UpdateRestaurantSettingsDto,
  ): Promise<RestaurantSettingsDto> {
    return RestaurantSettingsDto.fromModel(
      await this.restaurantService.updateSettings(body),
      true,
    );
  }

  // ───────── Carta ─────────

  @Get('menu-items')
  async listMenuItems(): Promise<MenuItemDto[]> {
    const items = await this.restaurantService.listMenuItems();
    return items.map((model) => MenuItemDto.fromModel(model));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('menu-items')
  async createMenuItem(@Body() body: CreateMenuItemDto): Promise<MenuItemDto> {
    return MenuItemDto.fromModel(
      await this.restaurantService.createMenuItem(body),
    );
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Patch('menu-items/:id')
  async updateMenuItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMenuItemDto,
  ): Promise<MenuItemDto> {
    return MenuItemDto.fromModel(
      await this.restaurantService.updateMenuItem(id, body),
    );
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Delete('menu-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMenuItem(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.restaurantService.removeMenuItem(id);
  }

  // ───────── Galería ─────────

  @Get('photos')
  async listPhotos(): Promise<RestaurantPhotoDto[]> {
    const photos = await this.photoService.list();
    return photos.map((model) => RestaurantPhotoDto.fromModel(model));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('photos')
  @UseFilters(PhotoTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_BYTES },
    }),
  )
  async uploadPhoto(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<RestaurantPhotoDto> {
    if (!file)
      throw new BadRequestException('Adjuntá una imagen JPG, PNG o WebP');
    return RestaurantPhotoDto.fromModel(
      await this.photoService.upload(file.buffer),
    );
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Put('photos/order')
  async reorderPhotos(
    @Body() body: ReorderRestaurantPhotosDto,
  ): Promise<RestaurantPhotoDto[]> {
    const photos = await this.photoService.reorder(body.ids);
    return photos.map((model) => RestaurantPhotoDto.fromModel(model));
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Delete('photos/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePhoto(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.photoService.remove(id);
  }
}
