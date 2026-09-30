import { IsString, IsNotEmpty, IsEmail, IsEnum, IsOptional, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '../../../infrastructure/database/entities/User.entity';

export class RegisterDto {
  @Transform(({ value }) => value?.toString().trim().toLowerCase())
  @IsEmail({}, { message: 'Ingresá un email válido' })
  email!: string;

  // El máximo no es decorativo: bcrypt trunca en silencio a partir de 72 bytes.
  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña no puede estar vacía' })
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  @MaxLength(72, { message: 'La contraseña no puede superar los 72 caracteres' })
  password!: string;

  @Transform(({ value }) => value?.trim())
  @IsString({ message: 'El nombre completo debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El nombre completo no puede estar vacío' })
  @MinLength(3, { message: 'El nombre completo es muy corto' })
  @MaxLength(150, { message: 'El nombre completo es demasiado largo' })
  fullName!: string;

  @IsOptional()
  @IsEnum(UserRole, { message: 'El rol debe ser ADMIN o EMPLOYEE' })
  role?: UserRole;
}
