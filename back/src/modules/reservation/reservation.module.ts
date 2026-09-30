import { Module } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ReservationRepository } from './reservation.repository';
import { ReservationAdminService } from './reservation-admin.service';
import { ReservationAdminController } from './reservation-admin.controller';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { RoomModule } from '../room/room.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [BookingProcessModule, RoomModule, PaymentModule],
  controllers: [ReservationAdminController],
  providers: [ReservationService, ReservationRepository, ReservationAdminService],
  exports: [ReservationService],
})
export class ReservationModule {}
