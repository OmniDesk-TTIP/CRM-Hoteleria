import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomPhotoController } from './roomPhoto.controller';
import { RoomPublicController } from './roomPublic.controller';
import { RoomRepository } from './room.repository';
import { RoomPhotoRepository } from './roomPhoto.repository';
import { RoomService } from './room.service';
import { RoomPhotoService } from './roomPhoto.service';
import { RoomSeederService } from './room.seeder.service';

@Module({
  controllers: [RoomController, RoomPhotoController, RoomPublicController],
  providers: [
    RoomRepository,
    RoomPhotoRepository,
    RoomService,
    RoomPhotoService,
    RoomSeederService,
  ],
  exports: [RoomRepository],
})
export class RoomModule {}
