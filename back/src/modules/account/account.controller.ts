import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/auth.decorators';
import { AuthUser } from '../auth/auth.types';
import { AccountService } from './account.service';
import { OpenAccountDto, ReservationAccountDto } from './dto/account.dto';

// Cuenta corriente de una reserva (US-26/US-32). Como el resto del panel de reservas, la usan
// ADMIN y EMPLOYEE: solo la protege el guard global.
@Controller('reservations/:reservationId/account')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  get(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<ReservationAccountDto> {
    return this.accountService.getForReservation(reservationId);
  }

  /** Recepción registra el pago del resto de la estadía y con eso se abre la cuenta. */
  @Post()
  open(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: OpenAccountDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.open(reservationId, body.paymentMethod, user.id);
  }
}
