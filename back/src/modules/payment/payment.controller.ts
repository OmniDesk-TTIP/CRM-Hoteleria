import { Controller, Post, Get, Param, Body, Headers, HttpCode, HttpStatus, UnauthorizedException, NotFoundException, Logger } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { ReservationSummaryDto } from './dto/reservationSummary.dto';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Query, Res } from '@nestjs/common';
import { Public } from '../auth/auth.decorators';

// Todo este controller queda fuera de la autenticación: el webhook lo llama Mercado Pago,
// /success es el redirect de vuelta del checkout, y el resumen y el comprobante los abre el huesped desde el link de Telegram, sin cuenta.
@Public()
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly paymentRepository: PaymentRepository,
    private readonly configService: ConfigService,
  ) {}

  private async confirmPayment(paymentId: string, source: string): Promise<void> {
    const payment = await this.paymentService.getPayment(paymentId);

    if (!payment?.id || !payment?.external_reference) {
      this.logger.warn(`[${source}] Pago ${paymentId} sin external_reference; se ignora`);
      return;
    }

    if (payment.status !== 'approved') {
      this.logger.log(`[${source}] Pago ${payment.id} en estado "${payment.status}"; no se confirma`);
      return;
    }

    const reservation = await this.paymentRepository.findReservationById(payment.external_reference);
    if (!reservation) {
      this.logger.warn(`[${source}] Reserva no encontrada: external_reference=${payment.external_reference}`);
      return;
    }

    const confirmed = await this.paymentRepository.confirmIfPending(reservation.id, String(payment.id));
    if (!confirmed) {
      this.logger.log(`[${source}] Reserva ${reservation.id} ya estaba confirmada; no se vuelve a notificar`);
      return;
    }

    //una reserva pagada por MP siempre nace del bot y tiene telegramUserId; el campo es opcional en la entidad solo para las reservas manuales del panel, que no pasan por acá. El guard es por las dudas, sin usuario de Telegram no hay a quien avisarle.
    if (!reservation.telegramUserId) {
      this.logger.warn(`[${source}] Reserva ${reservation.id} confirmada pero sin telegramUserId; no se notifica`);
      return;
    }

    await this.paymentService.notifyPaymentApproved(reservation.telegramUserId, reservation.checkIn, reservation.checkOut);
    this.logger.log(`[${source}] Reserva ${reservation.id} confirmada con el pago ${payment.id}`);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: any,
    @Query() query: any,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    const dataId = query?.['data.id'] || body?.data?.id || query?.id || body?.id;
    const eventType = body?.type || query?.topic || body?.topic;

    if (!dataId) {
      this.logger.warn(`Webhook ignorado: sin ID válido. Body: ${JSON.stringify(body)} | Query: ${JSON.stringify(query)}`);
      return { received: true };
    }

    if (eventType !== 'payment') {
      this.logger.warn(`Ignorando evento de tipo: ${eventType}`);
      return { received: true };
    }

    if (xSignature && !this.paymentService.verifyWebhookSignature(xSignature, xRequestId ?? '', String(dataId))) {
      this.logger.warn(`Webhook rechazado: firma inválida para el pago ${dataId}`);
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    this.logger.log(`Procesando webhook de pago ID: ${dataId}`);
    await this.confirmPayment(String(dataId), 'webhook');

    return { received: true };
  }

  @Get(':reservationId/summary')
  async getReservationSummary(@Param('reservationId') reservationId: string): Promise<ReservationSummaryDto> {
    const reservation = await this.paymentRepository.findReservationById(reservationId);
    if (!reservation) {
      throw new NotFoundException('Reserva no encontrada');
    }

    return ReservationSummaryDto.fromEntity(reservation);
  }

  @Get('success')
  async getSuccessPage(
    @Res() res: Response,
    @Query('reservationId') reservationId?: string,
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
  ) {
    const mpPaymentId = paymentId || collectionId;
    if (mpPaymentId && mpPaymentId !== 'null') {
      try {
        await this.confirmPayment(mpPaymentId, 'back_url');
      } catch (error) {
        this.logger.error(`No se pudo confirmar el pago ${mpPaymentId} desde el back_url`, error as Error);
      }
    }

    const frontendBaseUrl = this.configService.getOrThrow<string>('FRONTEND_BASE_URL');
    res.redirect(reservationId ? `${frontendBaseUrl}/payment/success/${reservationId}` : `${frontendBaseUrl}/payment/success`);
  }

  @Get('receipt/:id')
  async downloadReceipt(@Param('id') id: string, @Res() res: Response, @Query('inline') inline?: string) {
    try {
      const buffer = await this.paymentService.generateReceiptPDF(id);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="reserva-${id}.pdf"`,
        'Content-Length': buffer.length,
      });
      res.end(buffer);
    } catch (error) {
      this.logger.error(`No se pudo generar el comprobante de la reserva ${id}`, error as Error);
      throw new NotFoundException('No se pudo generar el comprobante');
    }
  }
}