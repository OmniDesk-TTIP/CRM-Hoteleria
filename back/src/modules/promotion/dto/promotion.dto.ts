import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { trimString } from '../../../common/transforms';
import { PromotionTarget } from '../../../infrastructure/database/entities/Promotion.entity';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DISCOUNT_PERCENTAGE,
  MAX_TITLE_LENGTH,
  PromotionModel,
  PromotionStatus,
} from '../promotion.model';

const ISO_DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Body de `POST /promotions` y `PATCH /promotions/:id`: el formulario manda siempre todos los datos. */
export class SavePromotionDto {
  @Transform(trimString)
  @IsString({ message: 'El título debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El título no puede estar vacío' })
  @MaxLength(MAX_TITLE_LENGTH, {
    message: `El título no puede superar ${MAX_TITLE_LENGTH} caracteres`,
  })
  title!: string;

  @Transform(trimString)
  @IsString({ message: 'La descripción debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La descripción no puede estar vacía' })
  @MaxLength(MAX_DESCRIPTION_LENGTH, {
    message: `La descripción no puede superar ${MAX_DESCRIPTION_LENGTH} caracteres`,
  })
  description!: string;

  @IsInt({ message: 'El descuento debe ser un número entero' })
  @Min(1, { message: 'El descuento debe ser de al menos 1%' })
  @Max(MAX_DISCOUNT_PERCENTAGE, {
    message: `El descuento no puede superar ${MAX_DISCOUNT_PERCENTAGE}%`,
  })
  discountPercentage!: number;

  @Matches(ISO_DAY, { message: 'startDate debe tener el formato YYYY-MM-DD' })
  startDate!: string;

  @Matches(ISO_DAY, { message: 'endDate debe tener el formato YYYY-MM-DD' })
  endDate!: string;

  @IsIn(Object.values(PromotionTarget), {
    message: 'La promoción debe aplicar a ROOMS o SPA',
  })
  target!: PromotionTarget;

  @IsOptional()
  @IsInt({ message: 'La cantidad mínima de noches debe ser un número entero' })
  @Min(1, { message: 'La cantidad mínima de noches debe ser al menos 1' })
  minNights?: number | null;
}

export class SetPromotionEnabledDto {
  @IsBoolean({ message: 'enabled debe ser true o false' })
  enabled!: boolean;
}

export class ListPromotionsQueryDto {
  @IsOptional()
  @IsIn(Object.values(PromotionStatus), { message: 'Estado inválido' })
  status?: PromotionStatus;

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

export class PromotionDto {
  id!: string;
  title!: string;
  description!: string;
  discountPercentage!: number;
  startDate!: string;
  endDate!: string;
  target!: PromotionTarget;
  minNights!: number | null;
  enabled!: boolean;
  status!: PromotionStatus;
  createdAt!: string | null;

  static fromModel(model: PromotionModel, today: string): PromotionDto {
    const dto = new PromotionDto();
    dto.id = model.id;
    dto.title = model.title;
    dto.description = model.description;
    dto.discountPercentage = model.discountPercentage;
    dto.startDate = model.startDate;
    dto.endDate = model.endDate;
    dto.target = model.target;
    dto.minNights = model.minNights;
    dto.enabled = model.enabled;
    dto.status = model.getStatus(today);
    dto.createdAt = model.createdAt?.toISOString() ?? null;
    return dto;
  }
}
