import { IsString, IsNotEmpty, IsInt, IsNumber, IsPositive, IsOptional, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { RoomStatus } from '../../../infrastructure/database/entities/Room.entity';

export class UpdateRoomDto {
  @IsOptional()
  @Transform(({ value }) => value?.toString().trim())
  @IsString({ message: 'El número/nombre de la habitación debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El número/nombre de la habitación no puede estar vacío' })
  @MaxLength(20, { message: 'El número/nombre de la habitación es demasiado largo' })
  roomNumber?: string;

  @IsOptional()
  @Transform(({ value }) => value?.toString().trim())
  @IsString({ message: 'El tipo de habitación debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El tipo de habitación no puede estar vacío' })
  @MaxLength(60, { message: 'El tipo de habitación es demasiado largo' })
  categoryName?: string;

  @IsOptional()
  @IsInt({ message: 'La capacidad debe ser un número entero' })
  @IsPositive({ message: 'La capacidad debe ser un valor positivo' })
  capacity?: number;

  @IsOptional()
  @IsNumber({}, { message: 'El precio base debe ser un número' })
  @IsPositive({ message: 'El precio base debe ser un valor positivo' })
  basePrice?: number;

  @IsOptional()
  @IsIn(Object.values(RoomStatus), { message: 'Estado inválido' })
  status?: RoomStatus;
}
