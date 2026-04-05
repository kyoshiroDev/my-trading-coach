import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Cet email est déjà utilisé');

    const hashedPassword = await argon2.hash(dto.password);
    const user = await this.prisma.user.create({
      data: { email: dto.email, password: hashedPassword, name: dto.name },
      select: { id: true, email: true, name: true, plan: true, createdAt: true },
    });

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Identifiants invalides');

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Identifiants invalides');

    const safeUser = { id: user.id, email: user.email, name: user.name, plan: user.plan };
    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user: safeUser };
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env['JWT_REFRESH_SECRET'] ?? 'dev-refresh-secret',
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, plan: true },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user };
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

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(payload, {
        secret: process.env['JWT_REFRESH_SECRET'] ?? 'dev-refresh-secret',
        expiresIn: '7d',
      }),
    ]);
    return { access_token, refresh_token };
  }
}
