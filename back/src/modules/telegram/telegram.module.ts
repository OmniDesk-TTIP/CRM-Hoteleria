import { Module } from '@nestjs/common';
import { TelegramUpdate } from './telegram.update';
import { RagModule } from '../rag/rag.module';
import { ReservationModule } from '../reservation/reservation.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { ChatModule } from '../chat/chat.module';
import { SpaModule } from '../spa/spa.module';
import { SpaReservationModule } from '../spaReservation/spaReservation.module';
import { CancellationModule } from '../cancellation/cancellation.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { RestaurantReservationModule } from '../restaurantReservation/restaurantReservation.module';
import { RoomServiceModule } from '../roomService/roomService.module';

@Module({
  imports: [
    RagModule,
    ReservationModule,
    BookingProcessModule,
    ChatModule,
    SpaModule,
    SpaReservationModule,
    RestaurantModule,
    RestaurantReservationModule,
    RoomServiceModule,
    CancellationModule,
  ],
  providers: [TelegramUpdate],
})
export class TelegramModule {}
