import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SendChatMessageDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'El mensaje debe ser texto' })
  @IsNotEmpty({ message: 'El mensaje no puede estar vacío' })
  // 4096 es el límite duro de sendMessage en Telegram; se deja margen para no cortar al huésped.
  @MaxLength(4000, { message: 'El mensaje no puede superar los 4000 caracteres' })
  text!: string;
}
