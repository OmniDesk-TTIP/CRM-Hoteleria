import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { SpaReservationService } from './spaReservation.service';
import { ListSpaReservationsQueryDto } from './dto/listSpaReservations.dto';
import { UpdateSpaReservationStatusDto } from './dto/updateSpaReservationStatus.dto';
import {
  PaginatedSpaReservationsDto,
  SpaReservationDto,
} from './dto/spaReservation.dto';

// Turnos de spa que los huéspedes piden por el chat. Solo lo protege el guard
// global: cualquier usuario autenticado del panel, ADMIN o EMPLOYEE, los gestiona (CA4).
@Controller('spa-reservations')
export class SpaReservationController {
  constructor(private readonly spaReservationService: SpaReservationService) {}

  @Get()
  list(
    @Query() query: ListSpaReservationsQueryDto,
  ): Promise<PaginatedSpaReservationsDto> {
    return this.spaReservationService.list(query);
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateSpaReservationStatusDto,
  ): Promise<SpaReservationDto> {
    return this.spaReservationService.changeStatus(id, body.status);
  }
}
