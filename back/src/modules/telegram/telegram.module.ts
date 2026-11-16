import { Module } from '@nestjs/common';
import { TelegramUpdate } from './telegram.update';
import { BotModule } from '../bot/bot.module';
import { ReservationModule } from '../reservation/reservation.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { ChatModule } from '../chat/chat.module';
import { RoomServiceModule } from '../roomService/roomService.module';
import { GuestLanguageModule } from '../guestLanguage/guestLanguage.module';
import { TelegramLanguageHook } from './telegramLanguage.hook';

@Module({
  imports: [
    BotModule,
    // Los botones (room service, reserva vencida) no pasan por el bot: usan estos servicios directo.
    ReservationModule,
    BookingProcessModule,
    ChatModule,
    RoomServiceModule,
    GuestLanguageModule,
  ],
  providers: [TelegramUpdate, TelegramLanguageHook],
})
export class TelegramModule {}
