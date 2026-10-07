import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { hashPassword, needsPasswordRehash } from './password-hashing';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { DemoSeedService } from '../admin/demo-seed.service';
import { ProductEventsService } from '../product-events/product-events.service';
import { SetupsService } from '../setups/setups.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 heure

/**
 * Violation d'unicité Prisma sur l'email (P2002) : deux inscriptions concurrentes
 * avec la même adresse. On la traduit en 409 plutôt que de laisser filer un 500.
 */
function isEmailAlreadyTaken(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  const target = err.meta?.['target'];
  // `target` = champs en conflit ; absent selon l'adaptateur → on reste prudent et
  // on considère le conflit comme portant sur l'email (seul unique de la création).
  if (Array.isArray(target)) return target.includes('email');
  if (typeof target === 'string') return target.includes('email');
  return true;
}

// Champs renvoyés au front pour représenter l'utilisateur courant.
// Source de vérité unique utilisée par getMe / refresh / login / register
// afin que le store front (et profileIncomplete) ait toujours les mêmes
// données : notamment tradingAssets/favoriteAsset (sinon nudge faux positif).
const ME_SELECT = {
  id: true,
  email: true,
  name: true,
  plan: true,
  role: true,
  onboardingCompleted: true,
  market: true,
  goal: true,
  startingCapital: true,
  notificationsEmail: true,
  debriefAutomatic: true,
  marketingConsent: true,
  trialEndsAt: true,
  trialUsed: true,
  stripeSubscriptionStatus: true,
  stripeCurrentPeriodEnd: true,
  tradingStyle: true,
  tradingStrategy: true,
  tradingSessions: true,
  tradesPerDayMin: true,
  tradesPerDayMax: true,
  strategyDescription: true,
  tradingAssets: true,
  favoriteAsset: true,
  isDemo: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private resend: ResendService,
    private setups: SetupsService,
    private demoSeed: DemoSeedService,
    private productEvents: ProductEventsService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Cet email est déjà utilisé');

    const hashedPassword = await hashPassword(dto.password);

    let referredBy: string | null = null;
    if (dto.referralCode) {
      const ambassador = await this.prisma.user.findUnique({
        where: { referralCode: dto.referralCode.toUpperCase() },
        select: { referralCode: true },
      });
      if (ambassador?.referralCode) referredBy = ambassador.referralCode;
    }

    // Le `findUnique` ci-dessus donne un message rapide, mais ne protège PAS de la
    // concurrence : sur un double-clic, les deux requêtes le passent et la seconde
    // violait `User_email_key` → P2002 non rattrapé → 500 sur le tout premier geste
    // du nouvel utilisateur. La contrainte de base est la vraie
    // garantie ; on la traduit ici dans le 409 que le front sait déjà afficher.
    let user;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          password: hashedPassword,
          name: dto.name,
          referredBy,
          unsubToken: crypto.randomBytes(32).toString('hex'),
          marketingConsent: dto.marketingConsent === true,
          marketingConsentAt: dto.marketingConsent === true ? new Date() : null,
          // null si absent : la catégorie « direct / non renseigné » se fait à l'agrégation.
          acquisitionSource: dto.acquisitionSource ?? null,
          acquisitionMedium: dto.acquisitionMedium ?? null,
          acquisitionCampaign: dto.acquisitionCampaign ?? null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          plan: true,
          role: true,
          onboardingCompleted: true,
          createdAt: true,
        },
      });
    } catch (err) {
      if (isEmailAlreadyTaken(err)) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
      throw err;
    }

    // Setups par défaut dès le signup : le sélecteur de trade n'est jamais vide
    // et le coach IA a du contexte dès le 1er trade (aucune étape obligatoire).
    await this.setups.seedDefaults(user.id);

    const tokens = await this.generateTokens(user.id, user.email);
    const now = new Date();
    const me = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, lastSeenAt: now },
      select: ME_SELECT,
    });

    // Email de bienvenue à l'utilisateur : fire-and-forget
    this.resend
      .sendWelcomeFree({ to: user.email, userName: user.name ?? '' })
      .catch((err: unknown) =>
        this.logger.error(`Welcome email failed: ${String(err)}`),
      );

    // Plus d'e-mail admin par inscription : récapitulatif quotidien (admin/signup-digest.cron.ts).

    return { ...tokens, user: me };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Identifiants invalides');

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Identifiants invalides');

    const now = new Date();
    // Hash aux anciens paramètres (64 Mio) : remplacé dans la même écriture, sans requête de plus.
    const rehashed = needsPasswordRehash(user.password) ? await hashPassword(dto.password) : undefined;
    const safeUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, lastSeenAt: now, ...(rehashed ? { password: rehashed } : {}) },
      select: ME_SELECT,
    });

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
      select: ME_SELECT,
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');

    const tokens = await this.generateTokens(user.id, user.email);
    return { ...tokens, user };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ME_SELECT,
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    return user;
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Réponse identique que l'utilisateur existe ou non (anti-énumération)
    if (!user) return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    this.resend
      .sendResetPassword({
        to: user.email,
        userName: user.name ?? '',
        resetToken: rawToken,
      })
      .catch((err: unknown) =>
        this.logger.error(`Reset password email failed: ${String(err)}`),
      );
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

    const hashedPassword = await hashPassword(newPassword);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });
  }

  /**
   * Connexion au compte démo vitrine (lecture seule). Renvoie un token d'accès
   * long SANS refresh : la session démo est éphémère et le DemoReadOnlyGuard
   * neutralise toute écriture même si le token fuite (défense en profondeur).
   */
  async demoLogin() {
    // Démo fraîche pour chaque visiteur, même sans cron (dev) : re-seed si périmée. Un échec ne
    // bloque jamais la connexion, la démo actuelle est servie.
    await this.demoSeed.ensureFresh('connexion démo').catch((err: Error) =>
      this.logger.warn(`Re-seed démo à la connexion ignoré : ${err.message}`),
    );
    const user = await this.prisma.user.findFirst({
      where: { isDemo: true },
      select: ME_SELECT,
    });
    if (!user) throw new NotFoundException('Compte démo indisponible');
    // Entonnoir : visites de la démo (best-effort, n'échoue jamais).
    void this.productEvents.record(user.id, 'demo_open');

    const access_token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: '12h' },
    );
    return { access_token, user };
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
