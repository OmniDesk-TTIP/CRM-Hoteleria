import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ChatSessionStatus } from '../../../infrastructure/database/entities/ChatSession.entity';

/** Los query params llegan como string: 'true'/'1' son los únicos valores que cuentan como sí. */
const toBoolean = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

export class ListChatsQueryDto {
  @IsOptional()
  @IsIn(Object.values(ChatSessionStatus), { message: 'Estado de chat inválido' })
  status?: ChatSessionStatus;

  /** Solo las conversaciones con un pedido de intervención pendiente. */
  @IsOptional()
  @Transform(toBoolean)
  pendingHandover?: boolean;

  /** Solo las que tiene tomadas el usuario autenticado. */
  @IsOptional()
  @Transform(toBoolean)
  assignedToMe?: boolean;

  @IsOptional()
  @IsString({ message: 'search debe ser texto' })
  @MaxLength(60, { message: 'search no puede superar los 60 caracteres' })
  search?: string;

  // Sin este @Type, @IsInt rechaza el string que llega por query string.
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
  pageSize: number = 20;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortDir inválido' })
  sortDir: 'asc' | 'desc' = 'desc';
}
