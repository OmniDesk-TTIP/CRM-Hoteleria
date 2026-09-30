import { IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListChatMessagesQueryDto {
  /**
   * `createdAt` del mensaje más viejo que el panel ya tiene. Se devuelven los anteriores a ese
   * instante, así el scroll hacia arriba no se corre cuando entran mensajes nuevos abajo.
   */
  @IsOptional()
  @IsISO8601({}, { message: 'before debe ser una fecha ISO 8601' })
  before?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit debe ser un número entero' })
  @Min(1, { message: 'limit debe ser mayor a 0' })
  @Max(100, { message: 'limit no puede superar 100' })
  limit: number = 50;
}
