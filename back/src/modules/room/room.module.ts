import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomPublicController } from './roomPublic.controller';
import { RoomRepository } from './room.repository';
import { RoomService } from './room.service';
import { RoomSeederService } from './room.seeder.service';

@Module({
  controllers: [RoomController, RoomPublicController],
  providers: [RoomRepository, RoomService, RoomSeederService],
  exports: [RoomRepository],
})
export class RoomModule {}
