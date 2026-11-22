import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { SpaModule } from '../spa/spa.module';
import { RestaurantReservationController } from './restaurantReservation.controller';
import { RestaurantReservationRepository } from './restaurantReservation.repository';
import { RestaurantReservationService } from './restaurantReservation.service';

@Module({
  imports: [RestaurantModule, SpaModule, ChatModule],
  controllers: [RestaurantReservationController],
  providers: [RestaurantReservationRepository, RestaurantReservationService],
  exports: [RestaurantReservationService],
})
export class RestaurantReservationModule {}
