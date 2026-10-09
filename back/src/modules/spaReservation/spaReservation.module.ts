import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { SpaModule } from '../spa/spa.module';
import { SpaReservationController } from './spaReservation.controller';
import { SpaReservationRepository } from './spaReservation.repository';
import { SpaReservationService } from './spaReservation.service';

@Module({
  imports: [SpaModule, ChatModule],
  controllers: [SpaReservationController],
  providers: [SpaReservationRepository, SpaReservationService],
  exports: [SpaReservationService],
})
export class SpaReservationModule {}
