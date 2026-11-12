import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { RestaurantService } from './restaurant.service';
import { RestaurantPhotoService } from './restaurantPhoto.service';
import { PublicRestaurantDto } from './dto/restaurant.dto';
import { sendPhoto } from '../../common/photo.http';

// Fuera de la autenticación: la sección del restó de la web pública del hotel (US-17 CA1/CA6).
// Solo expone lo habilitado: un ítem o un restó deshabilitado deja de verse (CA7).
@Public()
@Controller('public/restaurant')
export class RestaurantPublicController {
  constructor(
    private readonly restaurantService: RestaurantService,
    private readonly photoService: RestaurantPhotoService,
  ) {}

  @Get()
  get(): Promise<PublicRestaurantDto> {
    return this.restaurantService.getPublicInfo();
  }

  @Get('photos/:id')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendPhoto(res, await this.photoService.getContent(id));
  }
}
