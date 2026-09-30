import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomRepository } from './room.repository';
import { RoomService } from './room.service';
import { RoomSeederService } from './room.seeder.service';

@Module({
  controllers: [RoomController],
  providers: [RoomRepository, RoomService, RoomSeederService],
  exports: [RoomRepository],
})
export class RoomModule {}
