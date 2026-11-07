import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { SpaModule } from '../spa/spa.module';
import { SupportHoursModule } from '../supportHours/supportHours.module';
import { ArrivalMessageRepository } from './arrivalMessage.repository';
import { ArrivalMessageService } from './arrivalMessage.service';

@Module({
  imports: [ChatModule, RestaurantModule, SpaModule, SupportHoursModule],
  providers: [ArrivalMessageRepository, ArrivalMessageService],
})
export class ArrivalMessageModule {}
