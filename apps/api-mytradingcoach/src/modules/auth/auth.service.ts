import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private resend: ResendService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Cet email est déjà utilisé');

    const hashedPassword = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, password: hashedPassword, name: dto.name },
      select: { id: true, email: true, name: true, plan: true, role: true, onboardingCompleted: true, createdAt: true },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    // Email de bienvenue — ne pas bloquer si Resend est down
    this.resend.sendWelcomeFree({ to: user.email, userName: user.name ?? '' })
      .catch((err: unknown) => this.logger.error(`Welcome email failed: ${String(err)}`));

    return { ...tokens, user };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Identifiants invalides');

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Identifiants invalides');

    const safeUser = { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role, onboardingCompleted: user.onboardingCompleted };
    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: safeUser };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env['JWT_REFRESH_SECRET'],
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, name: true, plan: true, role: true,
        onboardingCompleted: true, currency: true, currencyRate: true, startingCapital: true,
      },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role, onboardingCompleted: user.onboardingCompleted, currency: user.currency, currencyRate: user.currencyRate, startingCapital: user.startingCapital } };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, plan: true, role: true,
        trialEndsAt: true, onboardingCompleted: true,
        market: true, goal: true,
        currency: true, currencyRate: true, startingCapital: true,
        notificationsEmail: true, debriefAutomatic: true,
        trialEndsAt: true, trialUsed: true,
        stripeSubscriptionStatus: true, stripeCurrentPeriodEnd: true,
      },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    return user;
  }

  async startTrial(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    if (user.trialUsed) throw new BadRequestException('Essai déjà utilisé');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        trialUsed: true,
      },
      select: { id: true, email: true, name: true, plan: true, trialEndsAt: true, trialUsed: true },
    });
    return updated;
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Réponse identique que l'utilisateur existe ou non (anti-énumération)
    if (!user) return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    this.resend.sendResetPassword({
      to: user.email,
      userName: user.name ?? '',
      resetToken: rawToken,
    }).catch((err: unknown) => this.logger.error(`Reset password email failed: ${String(err)}`));
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { gt: new Date() },
      },
    });

    if (!user) throw new BadRequestException('Token invalide ou expiré');

    const hashedPassword = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, {
        secret: process.env['JWT_REFRESH_SECRET'],
        expiresIn: '7d',
      }),
    ]);
    return { access_token, refresh_token };
  }
}
