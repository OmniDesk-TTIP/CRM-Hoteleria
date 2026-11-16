import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { PaymentModule } from '../payment/payment.module';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { SpaModule } from '../spa/spa.module';
import {
  RoomServiceOrdersController,
  RoomServicePaymentController,
  RoomServicePublicController,
} from './roomService.controller';
import { RoomServiceRepository } from './roomService.repository';
import { RoomServiceService } from './roomService.service';

@Module({
  imports: [RestaurantModule, SpaModule, ChatModule, PaymentModule],
  controllers: [
    RoomServiceOrdersController,
    RoomServicePaymentController,
    RoomServicePublicController,
  ],
  providers: [RoomServiceRepository, RoomServiceService],
  exports: [RoomServiceService],
})
export class RoomServiceModule {}
