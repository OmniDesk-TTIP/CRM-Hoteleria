import { IsString, IsNotEmpty, IsUUID, IsIn, IsDateString, IsNumber, Min, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ReservationStatus } from '../../../infrastructure/database/entities/Reservation.entity';

/** Body de `POST /reservations` y `PATCH /reservations/:id`: alta y edición manual (CA2, CA3). */
export class SaveReservationDto {
  @Transform(({ value }) => value?.trim())
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre completo no puede estar vacío' })
  @MinLength(3, { message: 'El nombre completo es muy corto' })
  @MaxLength(150, { message: 'El nombre completo es demasiado largo' })
  guestFullName!: string;

  @Transform(({ value }) => value?.toString().trim())
  @Matches(/^\d{7,9}$/, { message: 'El DNI debe contener entre 7 y 9 dígitos numéricos' })
  guestDni!: string;

  @IsUUID('4', { message: 'roomId debe ser un UUID válido' })
  roomId!: string;

  @IsDateString({}, { message: 'checkIn debe ser una fecha válida (YYYY-MM-DD)' })
  checkIn!: string;

  @IsDateString({}, { message: 'checkOut debe ser una fecha válida (YYYY-MM-DD)' })
  checkOut!: string;

  @IsIn(Object.values(ReservationStatus), { message: 'Estado inválido' })
  status!: ReservationStatus;

  @IsNumber({}, { message: 'totalAmount debe ser un número' })
  @Min(0, { message: 'totalAmount no puede ser negativo' })
  totalAmount!: number;

  @IsNumber({}, { message: 'depositAmount debe ser un número' })
  @Min(0, { message: 'depositAmount no puede ser negativo' })
  depositAmount!: number;
}
