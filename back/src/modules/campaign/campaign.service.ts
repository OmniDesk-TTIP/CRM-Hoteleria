import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { MikroORM, RequestContext } from '@mikro-orm/core';
import { InjectBot } from 'nestjs-telegraf';
import { Context, Telegraf } from 'telegraf';
import {
  CampaignAudience,
  CampaignStatus,
} from '../../infrastructure/database/entities/Campaign.entity';
import { ChatService } from '../chat/chat.service';
import { AuthUser } from '../auth/auth.types';
import { PaginatedResultDto } from '../reservation/dto/adminReservation.dto';
import { CampaignRepository } from './campaign.repository';
import {
  CampaignContent,
  CampaignDispatcher,
  DeliveryResult,
} from './campaign.dispatcher';
import {
  buildCampaignText,
  buildChatNotice,
  detectImageType,
  validateCampaignLength,
} from './campaign.model';
import {
  CampaignDto,
  CreateCampaignDto,
  ListCampaignsQueryDto,
  RecipientsCountDto,
} from './dto/campaign.dto';

@Injectable()
export class CampaignService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CampaignService.name);
  /** El envío en curso, si hay uno. Corre fuera del request: el panel no lo espera. */
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly campaignRepository: CampaignRepository,
    private readonly chatService: ChatService,
    private readonly orm: MikroORM,
    @InjectBot() private readonly bot: Telegraf<Context>,
  ) {}

  /** Si el servidor se reinició a mitad de un envío, esa campaña no va a terminar nunca. */
  async onApplicationBootstrap(): Promise<void> {
    const interrupted = await RequestContext.create(this.orm.em, () =>
      this.campaignRepository.interruptUnfinished(new Date()),
    );
    if (interrupted > 0)
      this.logger.warn(
        `${interrupted} campaña(s) quedaron a medio enviar y se marcaron como interrumpidas`,
      );
  }

  async countRecipients(
    audience: CampaignAudience,
  ): Promise<RecipientsCountDto> {
    return {
      audience,
      count: await this.campaignRepository.countRecipients(audience),
    };
  }

  async list(
    query: ListCampaignsQueryDto,
  ): Promise<PaginatedResultDto<CampaignDto>> {
    const { items, total } = await this.campaignRepository.findPage(
      query.page,
      query.pageSize,
    );
    return {
      data: items.map((campaign) => CampaignDto.fromEntity(campaign)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * CA4: registra la campaña y devuelve enseguida; el envío sigue en segundo plano y va
   * actualizando los contadores. Una sola campaña a la vez, para no duplicar el ritmo de envío.
   */
  async create(
    dto: CreateCampaignDto,
    imageBuffer: Buffer | undefined,
    user: AuthUser,
  ): Promise<CampaignDto> {
    const imageType = imageBuffer ? detectImageType(imageBuffer) : undefined;
    if (imageBuffer && !imageType)
      throw new BadRequestException('La imagen tiene que ser JPG, PNG o WEBP');

    const lengthError = validateCampaignLength(
      dto.title,
      dto.message,
      !!imageBuffer,
    );
    if (lengthError) throw new BadRequestException(lengthError);

    if (await this.campaignRepository.hasCampaignInProgress())
      throw new ConflictException(
        'Ya hay una campaña enviándose. Esperá a que termine para mandar otra.',
      );

    const recipients = await this.campaignRepository.findRecipients(
      dto.audience,
    );
    if (recipients.length === 0)
      throw new BadRequestException('No hay contactos para esos destinatarios');

    const campaign = await this.campaignRepository.insert({
      title: dto.title,
      message: dto.message,
      audience: dto.audience,
      hasImage: !!imageBuffer,
      totalRecipients: recipients.length,
      createdById: user.id,
    });

    const content: CampaignContent = {
      text: buildCampaignText(dto.title, dto.message),
      image:
        imageBuffer && imageType
          ? { buffer: imageBuffer, type: imageType }
          : undefined,
    };
    const notice = buildChatNotice(dto.title, dto.message, !!imageBuffer);
    this.inFlight = this.dispatch(campaign.id, recipients, content, notice);

    return CampaignDto.fromEntity(campaign);
  }

  /** Resuelve cuando termina el envío en curso. Lo usan los tests para leer el resultado final. */
  async whenIdle(): Promise<void> {
    await this.inFlight;
  }

  /** Nunca rechaza: corre sin nadie que la espere. */
  private async dispatch(
    campaignId: string,
    recipients: string[],
    content: CampaignContent,
    notice: string,
  ): Promise<void> {
    let status = CampaignStatus.COMPLETED;
    try {
      // Cada lote en su propio contexto de MikroORM: el del request que creó la campaña ya terminó.
      await new CampaignDispatcher(this.bot.telegram).run(
        recipients,
        content,
        (results) =>
          RequestContext.create(this.orm.em, () =>
            this.recordBatch(campaignId, results, notice),
          ),
      );
    } catch (error) {
      status = CampaignStatus.INTERRUPTED;
      this.logger.error(
        `Se cortó el envío de la campaña ${campaignId}: ${error}`,
      );
    }

    try {
      await RequestContext.create(this.orm.em, () =>
        this.campaignRepository.finish(campaignId, status, new Date()),
      );
      this.logger.log(`Campaña ${campaignId} terminada (${status})`);
    } catch (error) {
      this.logger.error(`No se pudo cerrar la campaña ${campaignId}: ${error}`);
    }
  }

  private async recordBatch(
    campaignId: string,
    results: DeliveryResult[],
    notice: string,
  ): Promise<void> {
    const sent = results.filter((result) => result.outcome === 'SENT');
    const blocked = results.filter(
      (result) => result.outcome === 'BLOCKED',
    ).length;

    await this.campaignRepository.addProgress(campaignId, {
      sent: sent.length,
      failed: results.length - sent.length,
      blocked,
    });

    for (const { telegramUserId } of sent)
      await this.recordInChat(telegramUserId, notice);
  }

  /**
   * Queda en el chat del panel y en el historial que lee Chamber, por si el huésped responde
   * "me interesa la promo". Sin tocar la vista previa: si no, la campaña reordenaría toda la bandeja.
   */
  private async recordInChat(
    telegramUserId: string,
    notice: string,
  ): Promise<void> {
    try {
      const session = await this.chatService.getOrCreateSession(telegramUserId);
      await this.chatService.recordSystemMessage(session, notice, false);
    } catch (error) {
      this.logger.warn(
        `No se pudo registrar la campaña en el chat de ${telegramUserId}: ${error}`,
      );
    }
  }
}
