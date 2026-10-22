import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../../common/transforms';
import {
  Campaign,
  CampaignAudience,
  CampaignStatus,
} from '../../../infrastructure/database/entities/Campaign.entity';
import { MAX_TEXT_LENGTH, MAX_TITLE_LENGTH } from '../campaign.model';

const AUDIENCE_MESSAGE =
  'Los destinatarios deben ser ALL, CONFIRMED o NO_RESERVATION';

/** Llega como multipart (por la imagen opcional), así que todos los campos son texto. */
export class CreateCampaignDto {
  @Transform(trimString)
  @IsString({ message: 'El título debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MaxLength(MAX_TITLE_LENGTH, {
    message: `El título no puede superar ${MAX_TITLE_LENGTH} caracteres`,
  })
  title!: string;

  @Transform(trimString)
  @IsString({ message: 'El mensaje debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El mensaje no puede estar vacío' })
  @MaxLength(MAX_TEXT_LENGTH, {
    message: `El mensaje no puede superar ${MAX_TEXT_LENGTH} caracteres`,
  })
  message!: string;

  @IsIn(Object.values(CampaignAudience), { message: AUDIENCE_MESSAGE })
  audience!: CampaignAudience;
}

export class RecipientsCountQueryDto {
  @IsIn(Object.values(CampaignAudience), { message: AUDIENCE_MESSAGE })
  audience!: CampaignAudience;
}

export class RecipientsCountDto {
  audience!: CampaignAudience;
  count!: number;
}

export class ListCampaignsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page debe ser un número entero' })
  @Min(1, { message: 'page debe ser mayor a 0' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize debe ser un número entero' })
  @Min(1, { message: 'pageSize debe ser mayor a 0' })
  @Max(100, { message: 'pageSize no puede superar 100' })
  pageSize: number = 10;
}

export class CampaignDto {
  id!: string;
  title!: string;
  message!: string;
  audience!: CampaignAudience;
  hasImage!: boolean;
  status!: CampaignStatus;
  totalRecipients!: number;
  sentCount!: number;
  failedCount!: number;
  blockedCount!: number;
  createdByName!: string | null;
  createdAt!: string;
  finishedAt!: string | null;

  static fromEntity(campaign: Campaign): CampaignDto {
    const dto = new CampaignDto();
    dto.id = campaign.id;
    dto.title = campaign.title;
    dto.message = campaign.message;
    dto.audience = campaign.audience;
    dto.hasImage = campaign.hasImage;
    dto.status = campaign.status;
    dto.totalRecipients = campaign.totalRecipients;
    dto.sentCount = campaign.sentCount;
    dto.failedCount = campaign.failedCount;
    dto.blockedCount = campaign.blockedCount;
    dto.createdByName = campaign.createdBy?.fullName ?? null;
    dto.createdAt = campaign.createdAt.toISOString();
    dto.finishedAt = campaign.finishedAt?.toISOString() ?? null;
    return dto;
  }
}
