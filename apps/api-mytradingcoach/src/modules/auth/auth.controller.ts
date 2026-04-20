import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

function setRefreshCookie(res: Response, token: string): void {
  const isProd = process.env['NODE_ENV'] === 'production';
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'strict',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refresh_token, ...result } = await this.authService.register(dto);
    setRefreshCookie(res, refresh_token);
    return result;
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { refresh_token, ...result } = await this.authService.login(dto);
    setRefreshCookie(res, refresh_token);
    return result;
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string>)[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Refresh token manquant');

    const { refresh_token, ...result } = await this.authService.refresh(token);
    setRefreshCookie(res, refresh_token);
    return result;
  }

  @Public()
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
    return { message: 'Déconnecté' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    // 204 sans body — même réponse si l'email existe ou non (anti-énumération)
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
  }

  @Get('me')
  getMe(@CurrentUser() user: { id: string; email: string; name: string | null; plan: string; trialEndsAt: Date | null; trialUsed: boolean }) {
    return user;
  }

  @Post('start-trial')
  startTrial(@CurrentUser() user: { id: string }) {
    return this.authService.startTrial(user.id);
  }
}