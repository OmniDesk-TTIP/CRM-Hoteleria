import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class EvalConversationDto {
  /** Mensajes del huésped, en orden. Uno solo = pregunta suelta; varios = conversación. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(4000, { each: true })
  messages!: string[];

  /**
   * Huésped simulado. Si no viene se genera uno nuevo, así cada caso arranca sin historial.
   * Mandar el mismo id sirve para seguir una conversación en otro request.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}
