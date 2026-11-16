import { Module } from '@nestjs/common';
import { RestaurantModule } from '../restaurant/restaurant.module';
import { RoomServiceModule } from '../roomService/roomService.module';
import { SpaModule } from '../spa/spa.module';
import { MenuPdfController } from './menuPdf.controller';
import { MenuPdfService } from './menuPdf.service';

@Module({
  imports: [RestaurantModule, RoomServiceModule, SpaModule],
  controllers: [MenuPdfController],
  providers: [MenuPdfService],
  exports: [MenuPdfService],
})
export class MenuPdfModule {}
