import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { RestaurantService } from './restaurant.service';
import { RestaurantPhotoService } from './restaurantPhoto.service';
import { PublicRestaurantDto } from './dto/restaurant.dto';

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

  /**
   * La imagen en sí, para usar directo en un `<img>`. Cada foto tiene un id propio y nunca
   * cambia de contenido (reemplazarla es borrar y subir otra), así que se puede cachear sin
   * vencimiento.
   */
  @Get('photos/:id')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { data, mimeType } = await this.photoService.getContent(id);
    res
      .set({
        'Content-Type': mimeType,
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        // La landing y el panel son otros orígenes: sin esto Chrome bloquea la imagen si algún
        // día se sirve con Cross-Origin-Embedder-Policy.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      })
      .send(data);
  }
}
