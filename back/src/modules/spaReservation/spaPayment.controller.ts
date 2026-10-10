import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { PaymentService } from '../payment/payment.service';
import {
  readWebhook,
  WebhookBody,
  WebhookQuery,
} from '../payment/webhook.util';
import { SpaReservationService } from './spaReservation.service';

// Fuera de la autenticación: lo llama Mercado Pago (webhook) o el navegador del cliente que
// vuelve del checkout. Es el circuito de pago de los turnos de spa; las reservas de habitación
// siguen en /payment.
@Public()
@Controller('spa-payments')
export class SpaPaymentController {
  private readonly logger = new Logger(SpaPaymentController.name);

  constructor(
    private readonly spaReservationService: SpaReservationService,
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: WebhookBody,
    @Query() query: WebhookQuery,
    @Headers('x-signature') xSignature?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    const { dataId, eventType } = readWebhook(body, query);

    if (!dataId || eventType !== 'payment') {
      this.logger.warn(
        `Webhook de spa ignorado (id=${dataId}, tipo=${eventType})`,
      );
      return { received: true };
    }

    if (
      xSignature &&
      !this.paymentService.verifyWebhookSignature(
        xSignature,
        xRequestId ?? '',
        dataId,
      )
    ) {
      this.logger.warn(
        `Webhook de spa rechazado: firma inválida para el pago ${dataId}`,
      );
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    await this.spaReservationService.confirmPayment(dataId, 'webhook');
    return { received: true };
  }

  /** Vuelta del checkout: confirma el pago sin esperar al webhook y lleva al cliente al front. */
  @Get('success')
  async getSuccessPage(
    @Res() res: Response,
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
  ) {
    const mpPaymentId = paymentId || collectionId;
    if (mpPaymentId && mpPaymentId !== 'null') {
      try {
        await this.spaReservationService.confirmPayment(
          mpPaymentId,
          'back_url',
        );
      } catch (error) {
        this.logger.error(
          `No se pudo confirmar el pago ${mpPaymentId} desde el back_url`,
          error as Error,
        );
      }
    }

    const frontendBaseUrl =
      this.configService.getOrThrow<string>('FRONTEND_BASE_URL');
    res.redirect(`${frontendBaseUrl}/payment/success`);
  }
}
