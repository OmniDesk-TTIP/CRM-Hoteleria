import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { AuthRepository } from './auth.repository';
import { TokenService } from './token.service';
import { burnPasswordComparison, hashPassword, verifyPassword } from './password.util';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserDto } from './dto/user.dto';
import { AuthTokens } from './auth.types';
import { User, UserRole } from '../../infrastructure/database/entities/User.entity';

export interface LoginResult extends AuthTokens {
  user: UserDto;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly saltRounds: number;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly tokenService: TokenService,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS') ?? 10);
  }

  async register(dto: RegisterDto): Promise<UserDto> {
    const passwordHash = await hashPassword(dto.password, this.saltRounds);

    try {
      const user = await this.authRepository.createUser({
        email: dto.email,
        passwordHash,
        fullName: dto.fullName,
        role: dto.role ?? UserRole.EMPLOYEE,
      });

      this.logger.log(`Usuario creado: ${user.email} (${user.role})`);

      return UserDto.fromEntity(user);
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException('Ya existe un usuario con ese email');
      }

      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.authRepository.findUserByEmail(dto.email);

    if (!user) {
      await burnPasswordComparison(dto.password);
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    const passwordMatches = await verifyPassword(dto.password, user.passwordHash);

    if (!passwordMatches || !user.isActive) {
      throw new UnauthorizedException('Email o contraseña incorrectos');
    }

    const tokens = await this.tokenService.issueTokens(user);
    await this.authRepository.touchLastLogin(user.id);

    return { ...tokens, user: UserDto.fromEntity(user) };
  }

  async refresh(refreshToken: string | undefined): Promise<AuthTokens> {
    if (!refreshToken) {
      throw new UnauthorizedException('No hay una sesión activa');
    }

    return this.tokenService.rotate(refreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.tokenService.revoke(refreshToken);
    }
  }

  async findById(userId: string): Promise<User> {
    const user = await this.authRepository.findUserById(userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('La sesión no es válida');
    }

    return user;
  }
}
