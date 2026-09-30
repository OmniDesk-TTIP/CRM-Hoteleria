import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from './auth.repository';
import { hashPassword } from './password.util';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

@Injectable()
export class AuthSeederService implements OnModuleInit {
  private readonly logger = new Logger(AuthSeederService.name);

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;

    const count = await this.authRepository.countUsers();

    if (count > 0) {
      this.logger.log(`Ya existen ${count} usuarios cargados.`);
      return;
    }

    const email = this.configService.get<string>('ADMIN_BOOTSTRAP_EMAIL');
    const password = this.configService.get<string>('ADMIN_BOOTSTRAP_PASSWORD');

    if (!email || !password) {
      this.logger.warn(
        'No hay usuarios y faltan ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD: no se puede crear el primer administrador.',
      );
      return;
    }

    const saltRounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS') ?? 10);

    await this.authRepository.createUser({
      email: email.trim().toLowerCase(),
      passwordHash: await hashPassword(password, saltRounds),
      fullName: 'Administrador',
      role: UserRole.ADMIN,
    });

    this.logger.warn(`Administrador inicial creado: ${email}. Cambiá la contraseña cuanto antes.`);
  }
}
