import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UserDto } from './dto/user.dto';
import { CurrentUser, Public, Roles } from './auth.decorators';
import { RolesGuard } from './auth.guard';
import { AuthUser } from './auth.types';
import { UserRole } from '../../infrastructure/database/entities/User.entity';

export const REFRESH_COOKIE_NAME = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private cookieOptions(): CookieOptions {
    const ttlDays = Number(this.configService.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 7);

    return {
      httpOnly: true,
      secure: this.configService.get<string>('AUTH_COOKIE_SECURE') === 'true',
      sameSite: (this.configService.get<string>('AUTH_COOKIE_SAMESITE') ?? 'lax') as CookieOptions['sameSite'],
      path: '/auth',
      maxAge: ttlDays * 24 * 60 * 60 * 1000,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, accessToken, expiresIn, user } = await this.authService.login(dto);

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, this.cookieOptions());

    return { accessToken, expiresIn, user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { refreshToken, accessToken, expiresIn } = await this.authService.refresh(
      req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined,
    );

    res.cookie(REFRESH_COOKIE_NAME, refreshToken, this.cookieOptions());

    return { accessToken, expiresIn };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);

    res.clearCookie(REFRESH_COOKIE_NAME, { ...this.cookieOptions(), maxAge: undefined });
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @Post('register')
  async register(@Body() dto: RegisterDto): Promise<UserDto> {
    return this.authService.register(dto);
  }

  @Get('me')
  async me(@CurrentUser() currentUser: AuthUser): Promise<UserDto> {
    return UserDto.fromEntity(await this.authService.findById(currentUser.id));
  }
}
