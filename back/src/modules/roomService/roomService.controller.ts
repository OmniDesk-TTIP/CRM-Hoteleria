import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public, Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { PaymentService } from '../payment/payment.service';
import {
  readWebhook,
  WebhookBody,
  WebhookQuery,
} from '../payment/webhook.util';
import { RoomServiceService } from './roomService.service';
import {
  ListRoomServiceOrdersQueryDto,
  PaginatedRoomServiceOrdersDto,
  PublicRoomServiceDto,
  RoomServiceOrderDto,
  UpdateRoomServiceOrderStatusDto,
} from './roomService.dto';

// CA10: solo el Administrador ve y gestiona los pedidos de room service.
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
@Controller('room-service-orders')
export class RoomServiceOrdersController {
  constructor(private readonly roomServiceService: RoomServiceService) {}

  @Get()
  list(
    @Query() query: ListRoomServiceOrdersQueryDto,
  ): Promise<PaginatedRoomServiceOrdersDto> {
    return this.roomServiceService.list(query);
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoomServiceOrderStatusDto,
  ): Promise<RoomServiceOrderDto> {
    return this.roomServiceService.changeStatus(id, body.status);
  }
}

// Fuera de la autenticación: lo llama Mercado Pago (webhook) o el navegador del huésped que
// vuelve del checkout. Es el circuito de pago de los pedidos de room service (CA9).
@Public()
@Controller('room-service-payments')
export class RoomServicePaymentController {
  private readonly logger = new Logger(RoomServicePaymentController.name);

  constructor(
    private readonly roomServiceService: RoomServiceService,
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
        `Webhook de room service ignorado (id=${dataId}, tipo=${eventType})`,
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
        `Webhook de room service rechazado: firma inválida para el pago ${dataId}`,
      );
      throw new UnauthorizedException('Firma de webhook inválida');
    }

    await this.roomServiceService.confirmPayment(dataId, 'webhook');
    return { received: true };
  }

  /** Vuelta del checkout: confirma el pago sin esperar al webhook y lleva al huésped al front. */
  @Get('success')
  async getSuccessPage(
    @Res() res: Response,
    @Query('payment_id') paymentId?: string,
    @Query('collection_id') collectionId?: string,
  ) {
    const mpPaymentId = paymentId || collectionId;
    if (mpPaymentId && mpPaymentId !== 'null') {
      try {
        await this.roomServiceService.confirmPayment(mpPaymentId, 'back_url');
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

// Fuera de la autenticación: la carta de room service para el link de la landing (CA2).
// Solo expone los platos habilitados y marcados para la habitación.
@Public()
@Controller('public/room-service')
export class RoomServicePublicController {
  constructor(private readonly roomServiceService: RoomServiceService) {}

  @Get()
  get(): Promise<PublicRoomServiceDto> {
    return this.roomServiceService.getPublicMenu();
  }
}
