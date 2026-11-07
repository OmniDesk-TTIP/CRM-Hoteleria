import { Module } from '@nestjs/common';
import { ReservationService } from './reservation.service';
import { ReservationRepository } from './reservation.repository';
import { ReservationAdminService } from './reservation-admin.service';
import { ReservationAdminController } from './reservation-admin.controller';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { RoomModule } from '../room/room.module';
import { PaymentModule } from '../payment/payment.module';
import { CancellationModule } from '../cancellation/cancellation.module';
import { ChatModule } from '../chat/chat.module';
import { ReservationExpirationService } from './reservationExpiration.service';
import { PromotionModule } from '../promotion/promotion.module';

@Module({
  imports: [
    BookingProcessModule,
    RoomModule,
    PaymentModule,
    CancellationModule,
    ChatModule,
    PromotionModule,
  ],
  controllers: [ReservationAdminController],
  providers: [
    ReservationService,
    ReservationRepository,
    ReservationAdminService,
    ReservationExpirationService,
  ],
  exports: [ReservationService, ReservationRepository],
})
export class ReservationModule {}
