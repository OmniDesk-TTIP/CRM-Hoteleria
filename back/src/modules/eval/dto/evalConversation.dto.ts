import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class EvalConversationDto {
  /**
   * Mensajes del huésped, en orden. Uno solo = pregunta suelta; varios = conversación. Un mensaje
   * `[botón] Etiqueta` toca ese botón de la respuesta anterior (por ahora, los de room service).
   */
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

  /** US-27: el huésped está alojado (estadía confirmada que incluye hoy). */
  @IsOptional()
  @IsBoolean()
  stay?: boolean;

  /** US-27: además tiene la cuenta corriente abierta. Implica `stay`. */
  @IsOptional()
  @IsBoolean()
  account?: boolean;
}
