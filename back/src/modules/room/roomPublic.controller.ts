import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { RoomService } from './room.service';
import { RoomPhotoService } from './roomPhoto.service';
import { PublicRoomDto } from './dto/publicRoom.dto';
import { sendPhoto } from '../../common/photo.http';

// Fuera de la autenticación: la sección de habitaciones de la web pública del hotel. Solo
// publica los tipos que tienen al menos una habitación activa.
@Public()
@Controller('public/rooms')
export class RoomPublicController {
  constructor(
    private readonly roomService: RoomService,
    private readonly photoService: RoomPhotoService,
  ) {}

  @Get()
  list(): Promise<PublicRoomDto[]> {
    return this.roomService.listPublic();
  }

  @Get('photos/:id')
  async photo(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    sendPhoto(res, await this.photoService.getContent(id));
  }
}
