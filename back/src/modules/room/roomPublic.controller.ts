import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';
import { RoomService } from './room.service';
import { PublicRoomDto } from './dto/publicRoom.dto';

// Fuera de la autenticación: la sección de habitaciones de la web pública del hotel. Solo
// publica los tipos que tienen al menos una habitación activa.
@Public()
@Controller('public/rooms')
export class RoomPublicController {
  constructor(private readonly roomService: RoomService) {}

  @Get()
  list(): Promise<PublicRoomDto[]> {
    return this.roomService.listPublic();
  }
}
