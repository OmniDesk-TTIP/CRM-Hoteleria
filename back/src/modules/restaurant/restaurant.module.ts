import { Module } from '@nestjs/common';
import { SpaModule } from '../spa/spa.module';
import { RestaurantController } from './restaurant.controller';
import { RestaurantPublicController } from './restaurantPublic.controller';
import { RestaurantRepository } from './restaurant.repository';
import { RestaurantPhotoRepository } from './restaurantPhoto.repository';
import { RestaurantService } from './restaurant.service';
import { RestaurantPhotoService } from './restaurantPhoto.service';

// SpaModule aporta la elegibilidad del huésped (CA2) y el reloj del hotel, que son los mismos
// para todos los servicios internos.
@Module({
  imports: [SpaModule],
  controllers: [RestaurantController, RestaurantPublicController],
  providers: [
    RestaurantRepository,
    RestaurantPhotoRepository,
    RestaurantService,
    RestaurantPhotoService,
  ],
  exports: [RestaurantService],
})
export class RestaurantModule {}
