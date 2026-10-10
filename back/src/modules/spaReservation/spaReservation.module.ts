import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { PaymentModule } from '../payment/payment.module';
import { SpaModule } from '../spa/spa.module';
import { SpaPaymentController } from './spaPayment.controller';
import { SpaReservationController } from './spaReservation.controller';
import { SpaReservationRepository } from './spaReservation.repository';
import { SpaReservationService } from './spaReservation.service';

@Module({
  imports: [SpaModule, ChatModule, PaymentModule],
  controllers: [SpaReservationController, SpaPaymentController],
  providers: [SpaReservationRepository, SpaReservationService],
  exports: [SpaReservationService],
})
export class SpaReservationModule {}
