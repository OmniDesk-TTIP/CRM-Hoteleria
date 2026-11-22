import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import {
  ReservationAccountDto,
  ReverseEntryDto,
} from '../account/dto/account.dto';
import { RestaurantReservationService } from './restaurantReservation.service';
import {
  ChargeRestaurantTicketDto,
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

  /** US-27: carga el ticket del restó de esta mesa a la cuenta de la estadía. */
  @Post(':id/tickets')
  chargeTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ChargeRestaurantTicketDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.restaurantReservationService.chargeTicket(id, body, {
      userId: user.id,
    });
  }

  /** US-27: solo un administrador anula un ticket cargado por error, con motivo. */
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post(':id/tickets/:entryId/reversal')
  reverseTicket(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: ReverseEntryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.restaurantReservationService.reverseTicket(
      id,
      entryId,
      body.reason,
      { userId: user.id },
    );
  }
}
