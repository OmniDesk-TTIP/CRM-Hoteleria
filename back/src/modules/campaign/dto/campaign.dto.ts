import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../../common/transforms';
import {
  Campaign,
  CampaignAudience,
  CampaignStatus,
  CampaignStayFilter,
} from '../../../infrastructure/database/entities/Campaign.entity';
import {
  MAX_GUESTS_FILTER,
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
} from '../campaign.model';

const AUDIENCE_MESSAGE =
  'Los destinatarios deben ser ALL, CONFIRMED o NO_RESERVATION';
const STAY_FILTER_MESSAGE =
  'El estado de la estadía debe ser IN_HOUSE, UPCOMING, FINISHED, UNPAID o QUOTED';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Query y multipart mandan los opcionales vacíos como "": se tratan como ausentes. */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

/** Como `emptyToUndefined`, pero además pasa a número (sin `@Type`, que convertiría "" en 0). */
const toOptionalNumber = ({ value }: { value: unknown }) => {
  const present = emptyToUndefined({ value });
  return typeof present === 'string' ? Number(present) : present;
};

const OptionalGuests = (label: string) =>
  applyDecorators(
    Transform(toOptionalNumber),
    IsOptional(),
    IsInt({ message: `${label} debe ser un número entero` }),
    Min(1, { message: `${label} debe ser al menos 1` }),
    Max(MAX_GUESTS_FILTER, {
      message: `${label} no puede superar ${MAX_GUESTS_FILTER}`,
    }),
  );

const OptionalDate = (label: string) =>
  applyDecorators(
    Transform(emptyToUndefined),
    IsOptional(),
    Matches(DATE_PATTERN, {
      message: `${label} debe tener el formato YYYY-MM-DD`,
    }),
    IsISO8601({ strict: true }, { message: `${label} no es una fecha válida` }),
  );

/**
 * A quién va la campaña: el grupo base (CA3 de US-13) más el filtro opcional por estadía.
 * Las reglas que cruzan campos (fechas solo con ciertos estados, desde ≤ hasta, mín ≤ máx)
 * están en `validateRecipientFilter`.
 */
export class RecipientFilterDto {
  @IsIn(Object.values(CampaignAudience), { message: AUDIENCE_MESSAGE })
  audience!: CampaignAudience;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsIn(Object.values(CampaignStayFilter), { message: STAY_FILTER_MESSAGE })
  stayFilter?: CampaignStayFilter;

  @OptionalDate('La fecha "desde"')
  stayFrom?: string;

  @OptionalDate('La fecha "hasta"')
  stayTo?: string;

  @OptionalGuests('La cantidad mínima de personas')
  minGuests?: number;

  @OptionalGuests('La cantidad máxima de personas')
  maxGuests?: number;
}

/** Llega como multipart (por la imagen opcional), así que todos los campos son texto. */
export class CreateCampaignDto extends RecipientFilterDto {
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
}

export class RecipientsCountQueryDto extends RecipientFilterDto {}

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
  stayFilter!: CampaignStayFilter | null;
  stayFrom!: string | null;
  stayTo!: string | null;
  minGuests!: number | null;
  maxGuests!: number | null;
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
    dto.stayFilter = campaign.stayFilter ?? null;
    dto.stayFrom = campaign.stayFrom ?? null;
    dto.stayTo = campaign.stayTo ?? null;
    dto.minGuests = campaign.minGuests ?? null;
    dto.maxGuests = campaign.maxGuests ?? null;
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
