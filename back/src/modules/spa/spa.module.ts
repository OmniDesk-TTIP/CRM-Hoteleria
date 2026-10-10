import { Module } from '@nestjs/common';
import { SpaController } from './spa.controller';
import { SpaService } from './spa.service';
import { SpaRepository } from './spa.repository';
import { ReservationModule } from '../reservation/reservation.module';
import { SupportHoursModule } from '../supportHours/supportHours.module';

@Module({
  imports: [ReservationModule, SupportHoursModule],
  controllers: [SpaController],
  providers: [SpaRepository, SpaService],
  exports: [SpaService],
})
export class SpaModule {}
