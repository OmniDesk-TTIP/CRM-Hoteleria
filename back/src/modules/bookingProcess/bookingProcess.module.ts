import { Module } from '@nestjs/common';
import { BookingProcessService } from './bookingProcess.service';
import { BookingProcessRepository } from './bookingProcess.repository';

@Module({
  providers: [BookingProcessService, BookingProcessRepository],
  exports: [BookingProcessService],
})
export class BookingProcessModule {}
