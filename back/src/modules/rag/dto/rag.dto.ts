import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class IngestDataDto {
  @IsString({ message: 'El texto debe ser una cadena de caracteres' })
  @IsNotEmpty({ message: 'El texto no puede estar vacío' })
  @MinLength(10, {
    message:
      'El texto es muy corto para ser vectorizado (mínimo 10 caracteres)',
  })
  @MaxLength(2000, {
    message:
      'El texto excede el límite permitido por chunk (máximo 2000 caracteres)',
  })
  text!: string;
}

export class AskQuestionDto {
  @Transform(({ value }) => value?.trim())
  @MaxLength(300, {
    message: 'La pregunta es demasiado larga (máximo 300 caracteres)',
  })
  @MinLength(5, { message: 'La pregunta debe tener al menos 5 caracteres' })
  @IsNotEmpty({ message: 'La pregunta no puede estar vacía' })
  @IsString({ message: 'La pregunta debe ser una cadena de texto' })
  question!: string;
}
