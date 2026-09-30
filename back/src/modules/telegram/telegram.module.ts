import { Module } from '@nestjs/common';
import { TelegramUpdate } from './telegram.update';
import { RagModule } from '../rag/rag.module';
import { ReservationModule } from '../reservation/reservation.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [RagModule, ReservationModule, BookingProcessModule, ChatModule],
  providers: [TelegramUpdate],
})
export class TelegramModule {}