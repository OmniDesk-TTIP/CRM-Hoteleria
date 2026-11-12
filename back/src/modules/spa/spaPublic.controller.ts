import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { SpaService } from './spa.service';
import { SpaPhotoService } from './spaPhoto.service';
import { PublicSpaDto, toPublicSpa } from './dto/spaPhoto.dto';
import { sendPhoto } from '../../common/photo.http';

// Fuera de la autenticación: la sección del spa de la web pública del hotel. Solo publica los
// servicios activos: uno deshabilitado deja de verse (igual que en Chamber, CA7).
@Public()
@Controller('public/spa')
export class SpaPublicController {
  constructor(
    private readonly spaService: SpaService,
    private readonly photoService: SpaPhotoService,
  ) {}

  @Get()
  async get(): Promise<PublicSpaDto> {
    const [services, photos] = await Promise.all([
      this.spaService.listActive(),
      this.photoService.list(),
    ]);
    return toPublicSpa(services, photos);
  }

  @Get('photos/:id')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendPhoto(res, await this.photoService.getContent(id));
  }
}
