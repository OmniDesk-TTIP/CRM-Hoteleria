import { applyDecorators } from '@nestjs/common';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimString } from '../../../common/transforms';

export const COMMENT_MAX_LENGTH = 1000;

/** Calificación obligatoria de 1 a 5 (CA3: sin todas las calificaciones no se envía). */
function Rating(label: string) {
  const message = `La calificación de ${label} debe ser un número entero del 1 al 5`;
  return applyDecorators(
    IsDefined({ message: `Falta la calificación de ${label}` }),
    IsInt({ message }),
    Min(1, { message }),
    Max(5, { message }),
  );
}

/** Lo que manda el huésped desde el formulario de la web (CA2). */
export class SubmitSurveyDto {
  @Rating('la estadía en general')
  overallRating!: number;

  @Rating('limpieza')
  cleanlinessRating!: number;

  @Rating('atención')
  attentionRating!: number;

  @Rating('servicios')
  servicesRating!: number;

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'El comentario debe ser texto' })
  @MaxLength(COMMENT_MAX_LENGTH, {
    message: `El comentario no puede superar los ${COMMENT_MAX_LENGTH} caracteres`,
  })
  comment?: string;

  /** El huésped autoriza que su reseña se muestre en la web del hotel. */
  @IsOptional()
  @IsBoolean({ message: 'publishConsent debe ser true o false' })
  publishConsent?: boolean;
}
