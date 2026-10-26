import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminPushEvent, AuthProvider, Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { hashPassword, needsPasswordRehash } from './password-hashing';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ResendService } from '../resend/resend.service';
import { DemoSeedService } from '../admin/demo-seed.service';
import { ProductEventsService } from '../product-events/product-events.service';
import { SetupsService } from '../setups/setups.service';
import { AdminNotifier } from '../admin-push/admin-notifier.service';
import { ADMIN_PUSH_MESSAGES } from '../admin-push/push-messages';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleIdTokenVerifier, GoogleTokenRefusedException } from './google-id-token.verifier';
import { resolveGoogleAuthConfig } from '../../config/google-auth-config';
import { redeleteCutoff, signupTrialData } from '../trial/signup-trial';

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

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
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
  trialSource: true,
  signupTrialEndsAt: true,
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

// Lus pour calculer les indicateurs de connexion (#618), puis retirés par `toMe` :
// ni le hash du mot de passe ni l'identifiant Google ne quittent l'API.
const ME_ROW_SELECT = {
  ...ME_SELECT,
  password: true,
  googleId: true,
  authProvider: true,
  signupFinalizedAt: true,
} satisfies Prisma.UserSelect;

type MeRow = Prisma.UserGetPayload<{ select: typeof ME_ROW_SELECT }>;

function toMe(row: MeRow) {
  const { password, googleId, authProvider, signupFinalizedAt, ...me } = row;
  return {
    ...me,
    hasPassword: !!password,
    googleLinked: !!googleId,
    // Inscription Google dont l'écran de finalisation (opt-in marketing) n'a pas été validé.
    needsSignupFinalization: authProvider === AuthProvider.GOOGLE && !signupFinalizedAt,
  };
}

/** Issue d'une connexion Google, renvoyée au front (message « compte relié » au 1er passage). */
export type GoogleAuthStatus = 'login' | 'linked' | 'created';

export interface GoogleAuthResult {
  access_token: string;
  refresh_token: string;
  user: ReturnType<typeof toMe>;
  googleStatus: GoogleAuthStatus;
  /** Liaison sur un compte jamais vérifié : son ancien mot de passe a été retiré. */
  passwordCleared: boolean;
}

interface NewAccount {
  email: string;
  password: string | null;
  name: string | null;
  referralCode?: string;
  marketingConsent: boolean;
  acquisitionSource?: string;
  acquisitionMedium?: string;
  acquisitionCampaign?: string;
  authProvider: AuthProvider;
  googleId?: string;
  emailVerifiedAt?: Date;
}

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
    private googleVerifier: GoogleIdTokenVerifier,
    @Optional() private adminNotifier?: AdminNotifier,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Cet email est déjà utilisé');

    const hashedPassword = await hashPassword(dto.password);

    // Le `findUnique` ci-dessus donne un message rapide, mais ne protège PAS de la
    // concurrence : sur un double-clic, les deux requêtes le passent et la seconde
    // violait `User_email_key` → P2002 non rattrapé → 500 sur le tout premier geste
    // du nouvel utilisateur. La contrainte de base est la vraie
    // garantie ; on la traduit ici dans le 409 que le front sait déjà afficher.
    try {
      return await this.createAccount({
        email: dto.email,
        password: hashedPassword,
        name: dto.name ?? null,
        referralCode: dto.referralCode,
        marketingConsent: dto.marketingConsent === true,
        acquisitionSource: dto.acquisitionSource,
        acquisitionMedium: dto.acquisitionMedium,
        acquisitionCampaign: dto.acquisitionCampaign,
        authProvider: AuthProvider.EMAIL,
      });
    } catch (err) {
      if (isEmailAlreadyTaken(err)) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
      throw err;
    }
  }

  /**
   * Création commune aux inscriptions e-mail et Google : mêmes effets (parrain, UTM, setups par
   * défaut, e-mail de bienvenue, push admin). Laisse remonter une violation d'unicité (P2002).
   */
  private async createAccount(data: NewAccount) {
    let referredBy: string | null = null;
    if (data.referralCode) {
      const ambassador = await this.prisma.user.findUnique({
        where: { referralCode: data.referralCode.toUpperCase() },
        select: { referralCode: true },
      });
      if (ambassador?.referralCode) referredBy = ambassador.referralCode;
    }

    // Essai Premium d'inscription (#769), refusé si l'e-mail vient de supprimer un compte.
    const now = new Date();
    const recentlyDeleted = await this.prisma.deletedAccount.findFirst({
      where: {
        email: { equals: data.email, mode: 'insensitive' },
        anonymizedAt: null,
        deletedAt: { gte: redeleteCutoff(now) },
      },
      select: { id: true },
    });

    const trial = signupTrialData(now, recentlyDeleted !== null);
    const user = await this.prisma.user.create({
      data: {
        ...trial,
        email: data.email,
        password: data.password,
        name: data.name,
        referredBy,
        unsubToken: crypto.randomBytes(32).toString('hex'),
        marketingConsent: data.marketingConsent,
        marketingConsentAt: data.marketingConsent ? new Date() : null,
        // null si absent : la catégorie « direct / non renseigné » se fait à l'agrégation.
        acquisitionSource: data.acquisitionSource ?? null,
        acquisitionMedium: data.acquisitionMedium ?? null,
        acquisitionCampaign: data.acquisitionCampaign ?? null,
        authProvider: data.authProvider,
        googleId: data.googleId ?? null,
        emailVerifiedAt: data.emailVerifiedAt ?? null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        onboardingCompleted: true,
        tokenVersion: true,
        createdAt: true,
      },
    });

    // Setups par défaut dès le signup : le sélecteur de trade n'est jamais vide
    // et le coach IA a du contexte dès le 1er trade (aucune étape obligatoire).
    await this.setups.seedDefaults(user.id);

    const tokens = await this.generateTokens(user);
    const me = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, lastSeenAt: now },
      select: ME_ROW_SELECT,
    });

    // Email de bienvenue à l'utilisateur : fire-and-forget
    this.resend
      .sendWelcomeFree({ to: user.email, userName: user.name ?? '', trialEndsAt: trial.trialEndsAt ?? null })
      .catch((err: unknown) =>
        this.logger.error(`Welcome email failed: ${String(err)}`),
      );

    // Plus d'e-mail admin par inscription : récapitulatif quotidien (admin/signup-digest.cron.ts).
    // Push admin : jamais pour un compte démo ni ADMIN (l'inscription crée un USER, garde-fou explicite).
    if (user.role !== Role.ADMIN) this.adminNotifier?.notify(AdminPushEvent.SIGNUP, ADMIN_PUSH_MESSAGES.signup());

    return { ...tokens, user: toMe(me) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new UnauthorizedException('Identifiants invalides');

    // Compte Google sans mot de passe : même réponse qu'un mauvais mot de passe (anti-énumération).
    if (!user.password) throw new UnauthorizedException('Identifiants invalides');
    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Identifiants invalides');

    const now = new Date();
    // Hash aux anciens paramètres (64 Mio) : remplacé dans la même écriture, sans requête de plus.
    const rehashed = needsPasswordRehash(user.password) ? await hashPassword(dto.password) : undefined;
    const safeUser = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, lastSeenAt: now, ...(rehashed ? { password: rehashed } : {}) },
      select: ME_ROW_SELECT,
    });

    const tokens = await this.generateTokens(user);
    return { ...tokens, user: toMe(safeUser) };
  }

  /**
   * Connexion ou inscription Google (#618). Le jeton est vérifié (signature, `aud`, `iss`,
   * expiration, e-mail vérifié), puis :
   * - `googleId` connu → connexion ;
   * - e-mail existant (insensible à la casse) → liaison. Si l'adresse n'avait jamais été prouvée,
   *   le mot de passe est supprimé et les sessions révoquées : un compte pré-créé par un tiers
   *   sur cette adresse ne lui laisse aucun accès (audit §6.1) ;
   * - sinon → création, avec les mêmes effets qu'une inscription e-mail, opt-in marketing faux.
   * Comptes démo et ADMIN : jamais de Google.
   */
  async googleAuth(dto: GoogleAuthDto, retryOnConflict = true): Promise<GoogleAuthResult> {
    const config = resolveGoogleAuthConfig(process.env);
    if (!config.enabled) throw new NotFoundException('Connexion Google indisponible');

    let identity;
    try {
      identity = await this.googleVerifier.verify(dto.credential, config.clientId);
    } catch (err) {
      if (err instanceof GoogleTokenRefusedException) {
        this.logger.warn(`Connexion Google refusée : ${err.reason}`);
      }
      throw err;
    }

    const now = new Date();
    const byGoogleId = await this.prisma.user.findUnique({
      where: { googleId: identity.googleId },
      select: { id: true, email: true, role: true, isDemo: true, tokenVersion: true },
    });
    if (byGoogleId) {
      this.assertGoogleAllowed(byGoogleId);
      const me = await this.prisma.user.update({
        where: { id: byGoogleId.id },
        data: { lastLoginAt: now, lastSeenAt: now },
        select: ME_ROW_SELECT,
      });
      return this.googleResult('login', byGoogleId, me);
    }

    const byEmail = await this.prisma.user.findFirst({
      where: { email: { equals: identity.email, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        role: true,
        isDemo: true,
        googleId: true,
        emailVerifiedAt: true,
        tokenVersion: true,
      },
    });
    if (byEmail) {
      this.assertGoogleAllowed(byEmail);
      if (byEmail.googleId) {
        // Même adresse, autre compte Google (`sub` différent) : on ne remplace jamais une liaison.
        throw new ConflictException({
          code: 'GOOGLE_ALREADY_LINKED',
          message: 'Ce compte est déjà relié à un autre compte Google',
        });
      }
      const unverified = !byEmail.emailVerifiedAt;
      const linked = await this.prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: identity.googleId,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? now,
          lastLoginAt: now,
          lastSeenAt: now,
          ...(unverified
            ? {
                password: null,
                resetPasswordToken: null,
                resetPasswordExpires: null,
                tokenVersion: { increment: 1 },
              }
            : {}),
        },
        select: { ...ME_ROW_SELECT, tokenVersion: true },
      });
      const { tokenVersion, ...me } = linked;
      return this.googleResult('linked', { ...byEmail, tokenVersion }, me, unverified);
    }

    try {
      const created = await this.createAccount({
        email: identity.email,
        password: null,
        name: identity.name,
        referralCode: dto.referralCode,
        marketingConsent: false,
        acquisitionSource: dto.acquisitionSource,
        acquisitionMedium: dto.acquisitionMedium,
        acquisitionCampaign: dto.acquisitionCampaign,
        authProvider: AuthProvider.GOOGLE,
        googleId: identity.googleId,
        emailVerifiedAt: now,
      });
      this.logger.log(`Connexion Google : created (user ${created.user.id})`);
      return { ...created, googleStatus: 'created' as GoogleAuthStatus, passwordCleared: false };
    } catch (err) {
      // Double clic : la 1re requête vient de créer le compte → la 2de s'y connecte.
      if (retryOnConflict && isUniqueViolation(err)) return this.googleAuth(dto, false);
      throw err;
    }
  }

  private assertGoogleAllowed(user: { role: Role; isDemo: boolean }): void {
    if (user.isDemo || user.role === Role.ADMIN) {
      throw new ForbiddenException({
        code: 'GOOGLE_NOT_ALLOWED',
        message: 'La connexion Google n’est pas disponible pour ce compte',
      });
    }
  }

  private async googleResult(
    status: GoogleAuthStatus,
    user: { id: string; email: string; tokenVersion: number },
    me: MeRow,
    passwordCleared = false,
  ): Promise<GoogleAuthResult> {
    this.logger.log(`Connexion Google : ${status}${passwordCleared ? ' (mot de passe retiré)' : ''} (user ${user.id})`);
    const tokens = await this.generateTokens(user);
    return { ...tokens, user: toMe(me), googleStatus: status, passwordCleared };
  }

  /** Écran de finalisation d'une inscription Google : opt-in marketing choisi explicitement. */
  async finalizeGoogleSignup(userId: string, marketingConsent: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { authProvider: true, signupFinalizedAt: true },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    if (user.authProvider !== AuthProvider.GOOGLE) {
      throw new BadRequestException('Aucune inscription Google à finaliser');
    }
    // Déjà finalisée (double envoi, autre onglet) : on ne réécrit pas le consentement.
    if (user.signupFinalizedAt) return this.getMe(userId);

    const now = new Date();
    const me = await this.prisma.user.update({
      where: { id: userId },
      data: {
        signupFinalizedAt: now,
        marketingConsent,
        marketingConsentAt: marketingConsent ? now : null,
      },
      select: ME_ROW_SELECT,
    });
    return toMe(me);
  }

  /** Délier Google : refusé sans mot de passe, sinon le compte deviendrait inaccessible. */
  async unlinkGoogle(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, googleId: true },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    if (!user.googleId) return this.getMe(userId);
    if (!user.password) {
      throw new BadRequestException({
        code: 'PASSWORD_REQUIRED',
        message: 'Définis d’abord un mot de passe pour pouvoir délier Google',
      });
    }
    const me = await this.prisma.user.update({
      where: { id: userId },
      data: { googleId: null },
      select: ME_ROW_SELECT,
    });
    this.logger.log(`Google délié (user ${userId})`);
    return toMe(me);
  }

  async refresh(refreshToken: string) {
    let payload: { sub: string; email: string; tv?: number };
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: process.env['JWT_REFRESH_SECRET'],
      });
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { ...ME_ROW_SELECT, tokenVersion: true },
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    // Sessions révoquées (liaison Google sur un compte non vérifié) ; jeton d'avant #618 = version 0.
    if ((payload.tv ?? 0) !== user.tokenVersion) {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }

    const { tokenVersion, ...me } = user;
    const tokens = await this.generateTokens({ id: user.id, email: user.email, tokenVersion });
    return { ...tokens, user: toMe(me) };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: ME_ROW_SELECT,
    });
    if (!user) throw new UnauthorizedException('Utilisateur introuvable');
    return toMe(user);
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

    // Compte Google sans mot de passe : même route et même 204, mais l'e-mail rappelle la
    // connexion Google et sert à DÉFINIR un mot de passe (audit §6.4).
    this.resend
      .sendResetPassword({
        to: user.email,
        userName: user.name ?? '',
        resetToken: rawToken,
        googleOnly: !user.password,
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
        // Le lien reçu par e-mail prouve la possession de l'adresse.
        emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
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
      select: ME_ROW_SELECT,
    });
    if (!user) throw new NotFoundException('Compte démo indisponible');
    // Entonnoir : visites de la démo (best-effort, n'échoue jamais).
    void this.productEvents.record(user.id, 'demo_open');

    const access_token = await this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: '12h' },
    );
    return { access_token, user: toMe(user) };
  }

  /** `tv` (version) dans le refresh token seulement : l'incrémenter révoque toutes les sessions. */
  private async generateTokens(user: { id: string; email: string; tokenVersion?: number }) {
    const payload = { sub: user.id, email: user.email };
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload, { expiresIn: '15m' }),
      this.jwtService.signAsync(
        { ...payload, tv: user.tokenVersion ?? 0 },
        {
          secret: process.env['JWT_REFRESH_SECRET'],
          expiresIn: '7d',
        },
      ),
    ]);
    return { access_token, refresh_token };
  }
}
