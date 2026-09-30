import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRepository } from './chat.repository';
import { ChatGateway } from './chat.gateway';
import { WsJwtGuard } from './ws-jwt.guard';
import { AuthModule } from '../auth/auth.module';
import { BookingProcessModule } from '../bookingProcess/bookingProcess.module';
import { SupportHoursModule } from '../supportHours/supportHours.module';

/**
 * El bot de Telegraf no se importa: nestjs-telegraf lo registra como provider global, así que
 * @InjectBot() funciona sin depender de TelegramModule (es lo que ya hace PaymentModule).
 * La dirección de la dependencia es TelegramModule → ChatModule, nunca al revés.
 */
@Module({
  imports: [AuthModule, BookingProcessModule, SupportHoursModule],
  controllers: [ChatController],
  providers: [ChatService, ChatRepository, ChatGateway, WsJwtGuard],
  exports: [ChatService],
})
export class ChatModule {}
