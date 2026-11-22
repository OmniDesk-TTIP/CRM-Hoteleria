import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { RestaurantReservationService } from './restaurantReservation.service';
import {
  ListRestaurantReservationsQueryDto,
  PaginatedRestaurantReservationsDto,
  RestaurantReservationDto,
  UpdateRestaurantReservationStatusDto,
} from './dto/restaurantReservation.dto';

// Pedidos de mesa que los huéspedes hacen por el chat. Solo lo protege el guard global:
// cualquier usuario autenticado del panel, ADMIN o EMPLOYEE, los gestiona (CA5).
@Controller('restaurant-reservations')
export class RestaurantReservationController {
  constructor(
    private readonly restaurantReservationService: RestaurantReservationService,
  ) {}

  @Get()
  list(
    @Query() query: ListRestaurantReservationsQueryDto,
  ): Promise<PaginatedRestaurantReservationsDto> {
    return this.restaurantReservationService.list(query);
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRestaurantReservationStatusDto,
  ): Promise<RestaurantReservationDto> {
    return this.restaurantReservationService.changeStatus(id, body.status);
  }
}
