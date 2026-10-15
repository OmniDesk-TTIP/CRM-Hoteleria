import { Module } from '@nestjs/common';
import { TelegramUpdate } from './telegram.update';
import { RagModule } from '../rag/rag.module';
import { ReservationModule } from '../reservation/reservation.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { ChatModule } from '../chat/chat.module';
import { SpaModule } from '../spa/spa.module';
import { SpaReservationModule } from '../spaReservation/spaReservation.module';
import { CancellationModule } from '../cancellation/cancellation.module';

@Module({
  imports: [
    RagModule,
    ReservationModule,
    BookingProcessModule,
    ChatModule,
    SpaModule,
    SpaReservationModule,
    CancellationModule,
  ],
  providers: [TelegramUpdate],
})
export class TelegramModule {}
