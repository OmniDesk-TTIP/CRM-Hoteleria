import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { trimString } from '../../../common/transforms';
import { RefundStatus } from '../../../infrastructure/database/entities/Reservation.entity';
import {
  CancellationPolicyModel,
  CancellationTier,
} from '../cancellation.model';

export class CancellationTierDto implements CancellationTier {
  @Type(() => Number)
  @IsInt({ message: 'Los días de anticipación deben ser un número entero' })
  @Min(0, { message: 'Los días de anticipación no pueden ser negativos' })
  minDaysBeforeCheckIn!: number;

  @Type(() => Number)
  @IsNumber({}, { message: 'El porcentaje de devolución debe ser un número' })
  @Min(0, { message: 'El porcentaje de devolución no puede ser negativo' })
  @Max(100, { message: 'El porcentaje de devolución no puede superar 100' })
  refundPercentage!: number;
}

export class CreateCancellationPolicyDto {
  @Transform(trimString)
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MinLength(3, { message: 'El nombre es muy corto' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name!: string;

  @IsArray({ message: 'Los escalones deben ser una lista' })
  @ArrayMinSize(1, { message: 'La política necesita al menos un escalón' })
  @ArrayMaxSize(10, { message: 'La política admite hasta 10 escalones' })
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers!: CancellationTierDto[];
}

export class UpdateCancellationPolicyDto {
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'El nombre debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre no puede estar vacío' })
  @MinLength(3, { message: 'El nombre es muy corto' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name?: string;

  @IsOptional()
  @IsArray({ message: 'Los escalones deben ser una lista' })
  @ArrayMinSize(1, { message: 'La política necesita al menos un escalón' })
  @ArrayMaxSize(10, { message: 'La política admite hasta 10 escalones' })
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers?: CancellationTierDto[];
}

export class CancellationPolicyDto {
  id!: string;
  name!: string;
  tiers!: CancellationTier[];
  active!: boolean;

  static fromModel(model: CancellationPolicyModel): CancellationPolicyDto {
    const dto = new CancellationPolicyDto();
    dto.id = model.id;
    dto.name = model.name;
    dto.tiers = model.tiers;
    dto.active = model.active;
    return dto;
  }
}

export class ListRefundsQueryDto {
  @IsOptional()
  @IsIn(Object.values(RefundStatus), { message: 'Estado inválido' })
  status?: RefundStatus;

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

export class CompleteRefundDto {
  @IsOptional()
  @IsDateString(
    {},
    { message: 'refundedAt debe ser una fecha válida (YYYY-MM-DD)' },
  )
  refundedAt?: string;
}

export class RefundDto {
  reservationId!: string;
  guestFullName!: string;
  guestDni!: string;
  roomNumber!: string;
  checkIn!: Date;
  checkOut!: Date;
  amount!: number;
  percentage!: number;
  policyName!: string | null;
  status!: RefundStatus;
  cancelledAt!: Date | null;
  refundedAt!: Date | null;
}

export class PaginatedRefundsDto {
  data!: RefundDto[];
  total!: number;
  page!: number;
  pageSize!: number;
}
