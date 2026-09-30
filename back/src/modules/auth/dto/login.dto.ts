import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @Transform(({ value }) => value?.toString().trim().toLowerCase())
  @IsEmail({}, { message: 'Ingresá un email válido' })
  email!: string;

  // A propósito sin MinLength: las reglas de largo son del registro, no del login.
  // Acá solo le darían pistas a quien esté probando contraseñas.
  @IsString({ message: 'La contraseña debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'La contraseña no puede estar vacía' })
  password!: string;
}
