import { Module } from '@nestjs/common';
import { SupportHoursController } from './supportHours.controller';
import { SupportHoursService } from './supportHours.service';
import { SupportHoursRepository } from './supportHours.repository';
import { SupportHoursSeederService } from './supportHours.seeder.service';

@Module({
  controllers: [SupportHoursController],
  providers: [SupportHoursService, SupportHoursRepository, SupportHoursSeederService],
  exports: [SupportHoursService],
})
export class SupportHoursModule {}
