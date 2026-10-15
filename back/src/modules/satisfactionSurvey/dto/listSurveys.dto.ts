import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

const DAY_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** Período de las respuestas (CA5), en días del calendario del hotel. Ambos extremos incluidos. */
export class SurveyPeriodQueryDto {
  @IsOptional()
  @Matches(DAY_REGEX, { message: 'from debe tener el formato YYYY-MM-DD' })
  from?: string;

  @IsOptional()
  @Matches(DAY_REGEX, { message: 'to debe tener el formato YYYY-MM-DD' })
  to?: string;
}

export class ListSurveysQueryDto extends SurveyPeriodQueryDto {
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
