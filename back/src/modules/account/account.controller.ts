import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { AccountService } from './account.service';
import {
  CheckoutDto,
  OpenAccountDto,
  RegisterChargeDto,
  RegisterPaymentDto,
  RegisterRefundDto,
  ReservationAccountDto,
  ReverseEntryDto,
} from './dto/account.dto';

// Cuenta corriente de una reserva (US-26/US-28/US-32). Como el resto del panel de reservas, la
// usan ADMIN y EMPLOYEE: solo la protege el guard global. Anular pagos y reintegrar es de ADMIN.
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

  /** US-30: estado de cuenta en PDF (ADMIN y EMPLOYEE). 404 si la reserva no tiene cuenta. */
  @Get('statement')
  async statement(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<StreamableFile> {
    const { source, filename } =
      await this.accountService.buildStatement(reservationId);
    return new StreamableFile(source, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
      length: source.length,
    });
  }

  /**
   * US-30: checkout de la estadía (ADMIN y EMPLOYEE). 409 con `code` si el saldo no es $0
   * (`balance`) o si hay consumos en curso (`activeServices`; se confirma con `force`).
   */
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  checkout(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: CheckoutDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.checkout(
      reservationId,
      body.force ?? false,
      user.id,
    );
  }

  /** Pago total o parcial de la cuenta. Devuelve la cuenta con el saldo restante. */
  @Post('payments')
  registerPayment(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: RegisterPaymentDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.registerPayment(reservationId, body, {
      userId: user.id,
    });
  }

  /** US-27: consumo del restó, el bar o recepción cargado a mano. Devuelve la cuenta actualizada. */
  @Post('charges')
  registerCharge(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: RegisterChargeDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.registerCharge(reservationId, body, {
      userId: user.id,
    });
  }

  /** US-27: solo un administrador anula un consumo cargado a mano, con motivo. */
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('charges/:entryId/reversal')
  reverseCharge(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: ReverseEntryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.reverseCharge(
      reservationId,
      entryId,
      body.reason,
      { userId: user.id },
    );
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('payments/:entryId/reversal')
  reversePayment(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() body: ReverseEntryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.reversePayment(
      reservationId,
      entryId,
      body.reason,
      { userId: user.id },
    );
  }

  /** Devuelve al huésped su saldo a favor. */
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('refunds')
  registerRefund(
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
    @Body() body: RegisterRefundDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReservationAccountDto> {
    return this.accountService.registerRefund(reservationId, body, {
      userId: user.id,
    });
  }
}
