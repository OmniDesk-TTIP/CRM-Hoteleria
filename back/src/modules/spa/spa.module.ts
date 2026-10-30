import { Module } from '@nestjs/common';
import { SpaController } from './spa.controller';
import { SpaPhotoController } from './spaPhoto.controller';
import { SpaPublicController } from './spaPublic.controller';
import { SpaService } from './spa.service';
import { SpaPhotoService } from './spaPhoto.service';
import { SpaRepository } from './spa.repository';
import { SpaPhotoRepository } from './spaPhoto.repository';
import { ReservationModule } from '../reservation/reservation.module';
import { SupportHoursModule } from '../supportHours/supportHours.module';

@Module({
  imports: [ReservationModule, SupportHoursModule],
  controllers: [SpaController, SpaPhotoController, SpaPublicController],
  providers: [SpaRepository, SpaPhotoRepository, SpaService, SpaPhotoService],
  exports: [SpaService],
})
export class SpaModule {}
