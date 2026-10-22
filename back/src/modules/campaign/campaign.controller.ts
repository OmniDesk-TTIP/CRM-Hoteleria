import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpStatus,
  PayloadTooLargeException,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import { RolesGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { UserRole } from '../../infrastructure/database/entities/User.entity';
import { PaginatedResultDto } from '../reservation/dto/adminReservation.dto';
import { CampaignService } from './campaign.service';
import { MAX_IMAGE_BYTES } from './campaign.model';
import {
  CampaignDto,
  CreateCampaignDto,
  ListCampaignsQueryDto,
  RecipientsCountDto,
  RecipientsCountQueryDto,
} from './dto/campaign.dto';

/** Multer corta con un 413 en inglés ("File too large"); acá se responde en español. */
@Catch(PayloadTooLargeException)
export class ImageTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(413)
      .json({
        statusCode: 413,
        error: 'Payload Too Large',
        message: `La imagen supera el tamaño máximo permitido (${MAX_IMAGE_BYTES / 1024 / 1024} MB)`,
      });
  }
}

/** Campañas masivas por Telegram (US-13). Solo para Administradores (CA6). */
@Controller('campaigns')
@Roles(UserRole.ADMIN)
@UseGuards(RolesGuard)
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  list(
    @Query() query: ListCampaignsQueryDto,
  ): Promise<PaginatedResultDto<CampaignDto>> {
    return this.campaignService.list(query);
  }

  /** CA3: cuántos contactos recibirían la campaña, para la vista previa. */
  @Get('recipients-count')
  countRecipients(
    @Query() query: RecipientsCountQueryDto,
  ): Promise<RecipientsCountDto> {
    return this.campaignService.countRecipients(query.audience);
  }

  /** 202: la campaña queda registrada y el envío sigue en segundo plano (CA4). */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseFilters(ImageTooLargeFilter)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_IMAGE_BYTES },
    }),
  )
  create(
    @Body() body: CreateCampaignDto,
    @UploadedFile() image: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<CampaignDto> {
    return this.campaignService.create(body, image?.buffer, user);
  }
}
