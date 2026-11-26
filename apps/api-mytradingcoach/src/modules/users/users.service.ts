import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GiveawayDisplayConsent, Role, Prisma, TrialSource } from '@prisma/client';
import { UTM_NONE, addCalendarMonths, type AcquisitionUtm, type AdminOfferPremiumResponse, type AdminRemoveOfferedPremiumResponse } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { closedTradeStats } from '../analytics/analytics.sql';
import { AmbassadorService } from '../ambassador/ambassador.service';
import { realMonthlyEur } from '../partner-codes/partner-code.util';
import { CompleteOnboardingDto } from './dto/onboarding.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { PREFERENCE_FIELDS, type PreferenceField } from './preference-fields';
import { AuthUserCacheService } from '../infra/auth-user-cache.service';
import { OFFER_PREMIUM_DEFAULT_DAYS, PREMIUM_OFFERABLE_WHERE, hasActiveStripeSubscription, premiumOfferRefusal } from './premium-offer.util';
import { StripeAccountClosureService } from '../stripe/stripe-account-closure.service';
import { DiscordGuildClient } from '../discord/discord-guild.client';
import { RedisService } from '../infra/redis.service';
import { GIVEAWAY_PUBLIC_CACHE_KEY } from '../giveaway/giveaway-cache';
import { insightsCooldownKey, insightsKeptKey } from '../ai/insights-cache-keys';
import { billingCacheKey } from '../stripe/stripe.helpers';
import { isPremiumAccess } from '../discord/discord-access.util';
import { DEMO_ACCOUNT_LOCKED } from './demo-account-locked';
import { REAL_USERS_WHERE } from '../../common/stats/real-users';
import { premiumAccessWhere, subscriptionStateWhere, subscriptionStatesWhere } from '../../common/stats/subscription-state-where';
import { emailEquals, escapeLike } from '../../common/utils/email.util';

/** Résiliation Stripe impossible : rien n'est supprimé, l'utilisateur peut réessayer. */
export const BILLING_CLOSURE_FAILED_MESSAGE =
  "La résiliation de ton abonnement a échoué : ton compte n'a pas été supprimé. " +
  'Réessaie dans quelques minutes ; si ça persiste, écris à support@mytradingcoach.app.';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  plan: true,
  role: true,
  trialEndsAt: true,
  trialUsed: true,
  trialSource: true,
  signupTrialEndsAt: true,
  subscriptionCanceledAt: true, // B5 #1013 (même champ que /auth/me)
  onboardingCompleted: true,
  market: true,
  goal: true,
  startingCapital: true,
  notificationsEmail: true,
  debriefAutomatic: true,
  marketingConsent: true,
  tradingStyle: true,
  tradingStrategy: true,
  tradingSessions: true,
  tradesPerDayMin: true,
  tradesPerDayMax: true,
  newsShieldMinutes: true,
  strategyDescription: true,
  tradingAssets: true,
  favoriteAsset: true,
  createdAt: true,
} as const;

/** Page Abonnements : essais, offerts, accès manuels et pauses listés (les plus récents d'abord). */
const TRIAL_LIST_MAX = 200;

/** Filtre par UTM d'inscription (#625) : absent = ignoré, `UTM_NONE` = non renseigné. */
function utmWhere(utm: Partial<AcquisitionUtm>): Prisma.UserWhereInput {
  const eq = (v: string) => (v === UTM_NONE ? null : v);
  return {
    ...(utm.source && { acquisitionSource: eq(utm.source) }),
    ...(utm.medium && { acquisitionMedium: eq(utm.medium) }),
    ...(utm.campaign && { acquisitionCampaign: eq(utm.campaign) }),
  };
}

const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  plan: true,
  role: true,
  trialEndsAt: true,
  trialSource: true,
  stripeSubscriptionStatus: true,
  stripeInterval: true,
  stripeCurrentPeriodEnd: true,
  // Annulation programmée (#813, état 5) : badge « Essai annulé » ou « Résilié » de la liste admin.
  stripeCancelAt: true,
  lastSeenAt: true,
  lastLoginAt: true,
  createdAt: true,
  acquisitionSource: true,
  acquisitionMedium: true,
  acquisitionCampaign: true,
  isInternal: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ambassador: AmbassadorService,
    private readonly billingClosure: StripeAccountClosureService,
    @Optional() private readonly userCache?: AuthUserCacheService,
    @Optional() private readonly discordGuild?: DiscordGuildClient,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email: emailEquals(email) }, orderBy: { createdAt: 'asc' } });
  }

  async findActivePremium() {
    const now = new Date();
    return this.prisma.user.findMany({
      where: {
        OR: [
          { plan: 'PREMIUM' },
          { trialEndsAt: { gt: now } },
          { role: Role.BETA_TESTER },
        ],
      },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        trialEndsAt: true,
      },
    });
  }

  // ── Admin : utilisateurs en ligne (actifs < 5min) ─────────────────────────

  async getOnlineUsers() {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    return this.prisma.user.findMany({
      where: { isDemo: false, lastSeenAt: { gte: threshold } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        role: true,
        lastSeenAt: true,
        lastLoginAt: true,
      },
    });
  }

  // ── Admin : liste paginée ─────────────────────────────────────────────────

  async adminFindAll(page = 1, limit = 20, search?: string, utm: Partial<AcquisitionUtm> = {}) {
    // Hors démo (cohérence avec le KPI « Utilisateurs » du dashboard).
    const where: Prisma.UserWhereInput = {
      isDemo: false,
      // Jokers `_` et `%` échappés (#1063) : `contains` de Prisma ne le fait pas (règle #999).
      ...(search && {
        OR: [
          { email: { contains: escapeLike(search), mode: 'insensitive' } },
          { name: { contains: escapeLike(search), mode: 'insensitive' } },
        ],
      }),
      ...utmWhere(utm),
    };

    const skip = (page - 1) * limit;
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: ADMIN_USER_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { users, total, page, limit };
  }

  // ── Admin : modale « Modifier » (nom, compte interne) ─────────────────────

  /** Ni rôle ni plan ici (A1/B2 #1064) : voir `setRole`, `offerPremium`, `removeOfferedPremium`. */
  async adminUpdate(targetId: string, dto: { name?: string; isInternal?: boolean }) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true, isDemo: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de modifier un administrateur');
    }
    if (target.isDemo) throw new ConflictException(DEMO_ACCOUNT_LOCKED);
    const updated = await this.prisma.user.update({
      where: { id: targetId },
      data: { name: dto.name, isInternal: dto.isInternal },
      select: ADMIN_USER_SELECT,
    });
    await this.userCache?.invalidate(targetId); // nom relu par le JWT (SCA-B3-01)
    return updated;
  }

  // ── Admin : suppression ───────────────────────────────────────────────────

  async adminDelete(targetId: string): Promise<void> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { role: true, isDemo: true },
    });
    if (!target) throw new NotFoundException('Utilisateur introuvable');
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de supprimer un administrateur');
    }
    // Sinon : une ligne DeletedAccount comptée et la vitrine cassée jusqu'au prochain re-seed.
    if (target.isDemo) throw new ConflictException(DEMO_ACCOUNT_LOCKED);
    await this.archiveAndDelete(targetId, 'admin');
  }

  /**
   * Purge d'un compte inactif depuis 2 ans (#824), appelée par le cron après les 4 préavis : même
   * chemin que la suppression demandée (Stripe résilié, DeletedAccount, caches, Discord), tracé
   * `deletedBy: 'inactivity'`. Lève comme `archiveAndDelete` (503 si Stripe échoue).
   */
  async deleteForInactivity(userId: string): Promise<void> {
    await this.archiveAndDelete(userId, 'inactivity');
  }

  /**
   * Archive une trace analytique (DeletedAccount) PUIS supprime le User, le tout
   * dans une transaction : on ne perd jamais la trace et on ne laisse pas d'orphelin.
   * L'identité (name/email) est anonymisée par cron après 90 j.
   *
   * Avant tout : résiliation immédiate des abonnements Stripe. Si Stripe échoue, on s'arrête
   * (503, rien supprimé) : un compte supprimé dont l'abonnement court encore serait prélevé
   * sans plus pouvoir se connecter pour résilier.
   */
  private async archiveAndDelete(
    userId: string,
    deletedBy: 'self' | 'admin' | 'inactivity',
    reason?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        plan: true,
        createdAt: true,
        referredBy: true,
        isInternal: true,
        stripeCustomerId: true,
        discordId: true,
        _count: { select: { trades: true } },
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    if (user.stripeCustomerId) {
      try {
        await this.billingClosure.cancelAllSubscriptions(user.stripeCustomerId);
      } catch (err: unknown) {
        this.logger.error(
          `Suppression du user ${userId} annulée : résiliation Stripe impossible (${err instanceof Error ? err.message : String(err)})`,
        );
        throw new ServiceUnavailableException(BILLING_CLOSURE_FAILED_MESSAGE);
      }
    }

    const tradesCount = user._count.trades;
    const lifetimeDays = Math.max(
      0,
      Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000),
    );

    await this.prisma.$transaction([
      this.prisma.deletedAccount.create({
        data: {
          name: user.name,
          email: user.email,
          signedUpAt: user.createdAt,
          lifetimeDays,
          plan: user.plan,
          hadTraded: tradesCount > 0,
          tradesCount,
          referredBy: user.referredBy,
          deletedBy,
          reason: reason?.trim() ? reason.trim().slice(0, 280) : null,
          isInternal: user.isInternal,
        },
      }),
      // Lot du tirage mensuel : le tirage reste compté (lien mis à null par la suppression), mais le
      // message, les pseudos et les accords d'affichage sont des données personnelles, effacées ici.
      this.prisma.giveawayWin.updateMany({
        where: { userId },
        data: {
          message: null, displayPseudo: null, instagramHandle: null,
          displayConsent: GiveawayDisplayConsent.NONE, instagramConsent: false,
        },
      }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
    await this.userCache?.invalidate(userId); // jeton encore valide d'un compte supprimé : refusé immédiatement
    // Dernière analyse IA (contenu tiré des trades) et délai des insights effacés avec le compte (#1056).
    // Redis absent : on ne bloque pas la suppression, les clés expirent seules sous 4 h.
    try {
      await this.redisService?.client.del(insightsKeptKey(userId), insightsCooldownKey(userId));
    } catch (err: unknown) {
      this.logger.warn(
        `Compte supprimé : cache IA des insights non effacé, expire sous 4 h (user ${userId}) : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Tirage mensuel : le nom d'un gagnant supprimé ne reste pas dans l'état public en cache (60 s).
    try {
      await this.redisService?.client.del(GIVEAWAY_PUBLIC_CACHE_KEY);
    } catch {
      /* Redis indisponible : le cache expire seul en 60 s */
    }
    // Le Discord relié perd ses rôles : sans compte, plus d'accès aux salons réservés (#741).
    if (user.discordId && (await this.discordGuild?.removePlanRoles(user.discordId)) === false) {
      // N2 (#1046) : le compte n'existe plus, rien ne retentera ; seul l'identifiant permet de
      // retirer les rôles à la main sur le serveur Discord.
      this.logger.warn(`Compte supprimé : rôles Discord non retirés, à retirer à la main (discordId ${user.discordId})`);
    }
  }

  async adminStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // Fenêtres de récence pour l'engagement (a tradé récemment, pas juste 1 fois).
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    // Utilisateurs « réels » : hors démo, hors comptes internes et hors ADMIN, filtre partagé.
    const REAL_USERS = REAL_USERS_WHERE;

    const [
      premiumMonthly, premiumAnnual,
      trials, offered, paused, freeUsers, newThisMonth, churnedThisMonth,
      betaTesters, ambassadors,
      totalUsers, totalPremium,
      tradersActifs7d, tradersActifs30d,
      comptesSupprimesMois, comptesSupprimesTotal,
    ] = await Promise.all([
      // MRR = revenu réellement encaissé → abonnements 'active' uniquement (les essais
      // 'trialing' ne paient pas et sont déjà comptés à part dans `trials`).
      this.prisma.user.count({
        where: { ...REAL_USERS, plan: 'PREMIUM', stripeInterval: 'month', stripeSubscriptionStatus: 'active' },
      }),
      this.prisma.user.count({
        where: { ...REAL_USERS, plan: 'PREMIUM', stripeInterval: 'year', stripeSubscriptionStatus: 'active' },
      }),
      // État réel (#828, `subscriptionState`) : le plan reste FREE pendant l'essai d'inscription.
      // Essais = essai d'inscription + essai d'abonnement (réservation fondateur, ancien essai 30 j).
      this.prisma.user.count({ where: { AND: [REAL_USERS, subscriptionStatesWhere(['signup_trial', 'subscription_trial'], now)] } }),
      this.prisma.user.count({ where: { AND: [REAL_USERS, subscriptionStateWhere('offered', now)] } }),
      this.prisma.user.count({ where: { AND: [REAL_USERS, subscriptionStateWhere('paused', now)] } }),
      this.prisma.user.count({ where: { AND: [REAL_USERS, subscriptionStateWhere('free', now)] } }),
      this.prisma.user.count({ where: { ...REAL_USERS, createdAt: { gte: startOfMonth } } }),
      // Churn fiable : résiliations effectives datées sur le mois courant (webhook Stripe).
      this.prisma.user.count({ where: { ...REAL_USERS, subscriptionCanceledAt: { gte: startOfMonth } } }),
      // role spécifique → écrase le `role: { not: ADMIN }` du spread (un user a un seul rôle).
      this.prisma.user.count({ where: { ...REAL_USERS, role: 'BETA_TESTER' } }),
      this.prisma.user.count({ where: { ...REAL_USERS, role: 'AMBASSADOR' } }),
      // Total réel (tous plans/rôles, hors démo + hors admin) + accès Premium (#828, décision G3) :
      // payants, essais, offerts, bêta et accès manuels.
      this.prisma.user.count({ where: { ...REAL_USERS } }),
      this.prisma.user.count({ where: { AND: [REAL_USERS, premiumAccessWhere(now)] } }),
      // Engagement par récence : ≥1 trade sur 7j / 30j (distinct users, hors démo+admin).
      // À ne pas confondre avec l'activation (= a tradé au moins une fois).
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: sevenDaysAgo } } } } }),
      this.prisma.user.count({ where: { ...REAL_USERS, trades: { some: { tradedAt: { gte: thirtyDaysAgo } } } } }),
      // Comptes supprimés (trace DeletedAccount) : distinct du churn d'abonnement, hors comptes
      // internes (#823). Les comptes démo ne sont jamais supprimés → naturellement hors démo.
      this.prisma.deletedAccount.count({ where: { isInternal: false, deletedAt: { gte: startOfMonth } } }),
      this.prisma.deletedAccount.count({ where: { isInternal: false } }),
    ]);

    // MRR/ARR sur le montant RÉELLEMENT payé (#525) : 49 € / 490/12 au prix normal, 29 € / 290/12
    // en fondateur, prix remisé d'un code partenaire tant que la remise court (puis prix normal),
    // −10 % filleul pendant 12 mois (#954).
    const mrrBreakdown = await this.realMrr(REAL_USERS, now);
    const mrr = mrrBreakdown.normal + mrrBreakdown.founder + mrrBreakdown.partner + mrrBreakdown.referral;
    const arr = mrr * 12;

    const monthly = premiumMonthly;
    const annual = premiumAnnual;

    return {
      mrr, arr, mrrBreakdown,
      totalUsers,
      totalPremium,
      premiumMonthly, premiumAnnual,
      monthly, annual,
      trials, offered, paused, freeUsers, newThisMonth, churnedThisMonth,
      betaTesters, ambassadors,
      tradersActifs7d, tradersActifs30d,
      comptesSupprimesMois, comptesSupprimesTotal,
    };
  }

  /**
   * MRR découpé normal / fondateur / partenaires / filleuls, abonnements `active` uniquement (arrondi
   * à l'euro). Un filleul dont la remise est terminée repasse en « normal ».
   */
  private async realMrr(where: Prisma.UserWhereInput, now: Date) {
    const paying = await this.prisma.user.findMany({
      where: { ...where, plan: 'PREMIUM', stripeSubscriptionStatus: 'active', stripeInterval: { in: ['month', 'year'] } },
      select: {
        stripeInterval: true,
        referralDiscountSince: true,
        founderSeat: { select: { status: true } },
        partnerRedemption: {
          select: { status: true, priceMonthlyEur: true, priceAnnualEur: true, durationMonths: true, createdAt: true },
        },
      },
    });
    const sums = { normal: 0, founder: 0, partner: 0, referral: 0 };
    for (const u of paying) {
      const interval = u.stripeInterval === 'year' ? 'year' : 'month';
      const founder = u.founderSeat?.status === 'ACTIVE';
      const r = u.partnerRedemption?.status === 'ACTIVE' ? u.partnerRedemption : null;
      const partner = r ? { ...r, since: r.createdAt } : null;
      const referralSince = u.referralDiscountSince ?? null;
      const amount = realMonthlyEur({ interval, founder, partner, referralSince, now });
      const normal = realMonthlyEur({ interval, now });
      const withPartner = partner ? realMonthlyEur({ interval, partner, now }) : normal;
      const bucket = founder
        ? 'founder'
        : partner && withPartner !== normal
          ? 'partner'
          : amount !== normal
            ? 'referral'
            : 'normal';
      sums[bucket] += amount;
    }
    return {
      normal: Math.round(sums.normal),
      founder: Math.round(sums.founder),
      partner: Math.round(sums.partner),
      referral: Math.round(sums.referral),
    };
  }

  // ── Rôle ──────────────────────────────────────────────────────────────────

  /**
   * Change le rôle d'un utilisateur depuis l'admin.
   *
   * Le rôle AMBASSADOR implique TOUJOURS un `referralCode` : sans lui, le lien
   * `?ref=` de l'ambassadeur est cassé et la liste admin affiche une ligne vide.
   * On délègue donc à `AmbassadorService.promote()` / `revoke()` au lieu d'écrire
   * le rôle à la main, seul moyen de garantir l'invariant quel que soit le chemin
   * de promotion (VAL avait le rôle sans code).
   */
  async setRole(targetUserId: string, role: Role): Promise<void> {
    if (role === Role.ADMIN) {
      throw new ForbiddenException(
        'Impossible de promouvoir un utilisateur au rôle ADMIN via API',
      );
    }

    const current = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true, role: true, isDemo: true },
    });
    if (!current) throw new NotFoundException('Utilisateur introuvable');
    if (current.isDemo) throw new ConflictException(DEMO_ACCOUNT_LOCKED);
    // S6 (#1063) : un administrateur n'est jamais rétrogradé par l'API (ni un autre, ni soi-même),
    // comme adminUpdate et adminDelete.
    if (current.role === Role.ADMIN) {
      throw new ForbiddenException('Impossible de modifier le rôle d’un administrateur');
    }

    if (role === Role.AMBASSADOR) {
      // Promotion : promote() génère le code s'il manque, et réutilise l'existant sinon.
      await this.ambassador.promote(current.email);
    } else if (current.role === Role.AMBASSADOR) {
      // Rétrogradation depuis AMBASSADOR : revoke() vide le code (comportement inchangé).
      // revoke() force USER ; si la cible est un autre rôle, on l'applique ensuite.
      await this.ambassador.revoke(current.email);
      if (role !== Role.USER) {
        await this.prisma.user.update({ where: { id: targetUserId }, data: { role } });
      }
      await this.userCache?.invalidate(targetUserId);
    } else {
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { role },
      });
      await this.userCache?.invalidate(targetUserId);
    }
    // A2/B3 (#1064) : le rôle BETA_TESTER donne le Premium ; tout changement de rôle réaligne
    // le statut de facturation et le rôle Discord, comme offerPremium.
    await this.realignPremiumAccess(targetUserId);
  }

  /**
   * Après un changement d'accès Premium hors Stripe (rôle, Premium offert retiré) : statut de
   * facturation relu tout de suite (cache de 5 min vidé) et rôle Discord recalculé. Un échec Redis
   * ou Discord ne bloque pas l'action : Discord se réaligne à la prochaine liaison ou par la
   * resynchronisation admin.
   */
  private async realignPremiumAccess(userId: string): Promise<void> {
    try {
      await this.redisService?.client.del(billingCacheKey(userId));
    } catch (err: unknown) {
      this.logger.warn(`Cache de facturation non vidé (user ${userId}) : ${err instanceof Error ? err.message : String(err)}`);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { discordId: true, plan: true, role: true, trialEndsAt: true },
    });
    if (!user?.discordId || !this.discordGuild) return;
    try {
      await this.discordGuild.setPlanRole(user.discordId, isPremiumAccess(user));
    } catch (err: unknown) {
      this.logger.warn(`Rôle Discord non réaligné (user ${userId}) : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * « Retirer bêta » (S6 #1063) : seulement un BETA_TESTER repasse USER. Avant, la route appelait
   * `setRole(USER)` sur n'importe quel rôle : un AMBASSADOR y perdait son code (`revoke`).
   */
  async removeBetaRole(targetUserId: string): Promise<void> {
    const current = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true },
    });
    if (!current) throw new NotFoundException('Utilisateur introuvable');
    if (current.role !== Role.BETA_TESTER) {
      throw new ConflictException('Ce compte n’est pas bêta-testeur');
    }
    await this.setRole(targetUserId, Role.USER);
  }

  /**
   * Premium offert par l'admin, sans carte ni abonnement Stripe : `trialEndsAt` dans le futur
   * (reconnu partout comme accès Premium), le plan reste FREE et l'accès tombe tout seul à la
   * date de fin. `trialUsed = true` : pas de second essai Stripe de 30 j au checkout.
   * Un mois déjà en cours, ou l'essai d'inscription, est prolongé à partir de sa date de fin.
   */
  async offerPremium(
    userId: string,
    days = OFFER_PREMIUM_DEFAULT_DAYS,
    adminId?: string,
  ): Promise<AdminOfferPremiumResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true, role: true, isDemo: true, trialEndsAt: true, discordId: true,
        stripeSubscriptionId: true, stripeSubscriptionStatus: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    // Mêmes refus que l'éligibilité du tirage gratuit (`premiumOfferRefusal`, une seule règle).
    const refusal = premiumOfferRefusal(user);
    if (refusal) throw new ConflictException(refusal);

    const now = Date.now();
    const from = Math.max(now, user.trialEndsAt?.getTime() ?? 0);
    const trialEndsAt = new Date(from + days * 86_400_000);
    await this.prisma.user.update({
      where: { id: userId },
      // Origine ADMIN ; la fin de l'essai d'inscription (`signupTrialEndsAt`) ne bouge pas (#769).
      data: { trialEndsAt, trialUsed: true, trialSource: TrialSource.ADMIN },
    });
    await this.userCache?.invalidate(userId); // le Premium doit s'ouvrir immédiatement
    // Statut de facturation (profil, bandeaux) relu tout de suite, pas après les 5 min du cache, et
    // rôle Discord Premium posé comme pour un abonnement payé. Un échec ne bloque pas l'offre.
    await this.redisService?.client.del(billingCacheKey(userId)).catch(() => undefined);
    if (user.discordId) {
      await this.discordGuild?.setPlanRole(user.discordId, true).catch((err: Error) =>
        this.logger.warn(`Rôle Discord Premium non posé après l'offre (user ${userId}) : ${err.message}`),
      );
    }
    this.logger.log(
      `Premium offert | admin: ${adminId ?? 'inconnu'}, user: ${userId}, fin: ${trialEndsAt.toISOString()}`,
    );
    return { trialEndsAt: trialEndsAt.toISOString() };
  }

  /**
   * Lot du tirage mensuel des gratuits (PROMPT-tirage-mensuel) : même mécanisme que « Offrir Premium »
   * (`trialEndsAt` futur, plan FREE, fin gérée par le cron de fin d'essai), origine GIVEAWAY, durée en
   * mois civils à partir de `max(maintenant, trialEndsAt)`. Écriture conditionnelle : refusée si le
   * compte n'est plus éligible au moment de l'attribution (abonnement pris entre-temps, rôle changé).
   * Renvoie le début et la fin de l'accès gagné.
   */
  async grantGiveawayPremium(userId: string, months: number, now = new Date()): Promise<{ startsAt: Date; endsAt: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        plan: true, role: true, isDemo: true, trialEndsAt: true, discordId: true,
        stripeSubscriptionId: true, stripeSubscriptionStatus: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    const refusal = premiumOfferRefusal(user);
    if (refusal) throw new ConflictException(refusal);

    const startsAt = new Date(Math.max(now.getTime(), user.trialEndsAt?.getTime() ?? 0));
    const endsAt = addCalendarMonths(startsAt, months);
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, ...PREMIUM_OFFERABLE_WHERE },
      data: { trialEndsAt: endsAt, trialUsed: true, trialSource: TrialSource.GIVEAWAY },
    });
    if (count === 0) throw new ConflictException('Compte plus éligible au Premium offert.');
    await this.userCache?.invalidate(userId);
    await this.redisService?.client.del(billingCacheKey(userId)).catch(() => undefined);
    if (user.discordId) {
      await this.discordGuild?.setPlanRole(user.discordId, true).catch((err: Error) =>
        this.logger.warn(`Rôle Discord Premium non posé après le tirage (user ${userId}) : ${err.message}`),
      );
    }
    this.logger.log(`Premium gagné au tirage | user: ${userId}, fin: ${endsAt.toISOString()}`);
    return { startsAt, endsAt };
  }

  /**
   * « Retirer le Premium offert » (B10 #1064, décision du 16/11) : seulement un Premium offert par
   * l'admin encore en cours (`trialSource` ADMIN ou absent, `trialEndsAt` futur), jamais un abonnement Stripe
   * (même en pause). L'accès tombe tout de suite (`trialEndsAt` = maintenant) ; si l'offre prolongeait
   * l'essai d'inscription encore en cours, l'essai d'inscription est rendu (`signupTrialEndsAt`, intact
   * depuis #769) : seuls les jours offerts par l'admin sont retirés.
   */
  async removeOfferedPremium(userId: string, adminId?: string): Promise<AdminRemoveOfferedPremiumResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        isDemo: true, trialSource: true, trialEndsAt: true, signupTrialEndsAt: true,
        stripeSubscriptionStatus: true,
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    if (user.isDemo) throw new ConflictException(DEMO_ACCOUNT_LOCKED);
    const status = user.stripeSubscriptionStatus;
    if (hasActiveStripeSubscription(status) || status === 'past_due' || status === 'unpaid') {
      throw new ConflictException('Abonnement Stripe\u00a0: jamais modifié à la main.');
    }
    const now = new Date();
    // Origine absente = Premium offert d'avant `trialSource` (même règle que isOfferedPremium) ;
    // seul l'essai d'inscription (SIGNUP) n'est jamais un Premium offert.
    if (user.trialSource === TrialSource.SIGNUP || !user.trialEndsAt || user.trialEndsAt <= now) {
      throw new ConflictException('Aucun Premium offert en cours.');
    }
    // Lot gagné au tirage mensuel : acquis, jamais retiré (décision du 16/11 limitée à l'offre de l'admin).
    if (user.trialSource === TrialSource.GIVEAWAY) {
      throw new ConflictException('Premium gagné au tirage\u00a0: le lot reste acquis.');
    }

    const signupEnd = user.signupTrialEndsAt && user.signupTrialEndsAt > now ? user.signupTrialEndsAt : null;
    // Lot du tirage gratuit encore en cours sous l'offre de l'admin (relecteur du 21/11) : le mois gagné
    // est rendu, jamais perdu. La fin la plus tardive l'emporte (essai d'inscription ou lot).
    const giveawayWin = await this.prisma.giveawayWin.findFirst({
      where: { userId, pool: 'FREE', activationStatus: 'APPLIED', endsAt: { gt: now } },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    });
    const giveawayEnd = giveawayWin?.endsAt ?? null;
    const restored =
      giveawayEnd && (!signupEnd || giveawayEnd >= signupEnd)
        ? { trialEndsAt: giveawayEnd, trialSource: TrialSource.GIVEAWAY }
        : signupEnd
          ? { trialEndsAt: signupEnd, trialSource: TrialSource.SIGNUP }
          : null;
    // Écriture conditionnelle : le where refait les contrôles (état « offert » de subscriptionState,
    // filtre partagé testé sur une vraie base), pour qu'un webhook Stripe arrivé entre la lecture et
    // l'écriture ne soit jamais écrasé.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: userId,
        AND: [
          subscriptionStateWhere('offered', now),
          // Jamais un lot du tirage (`not` seul exclurait aussi une origine nulle).
          { OR: [{ trialSource: null }, { trialSource: { not: TrialSource.GIVEAWAY } }] },
        ],
      },
      data: restored ?? { trialEndsAt: now },
    });
    if (count === 0) throw new ConflictException('Aucun Premium offert en cours.');
    await this.userCache?.invalidate(userId); // accès relu tout de suite par le JWT
    await this.realignPremiumAccess(userId);
    this.logger.log(
      `Premium offert retiré | admin: ${adminId ?? 'inconnu'}, user: ${userId}, accès rendu: ${restored ? `${restored.trialSource} jusqu'au ${restored.trialEndsAt.toISOString()}` : 'non'}`,
    );
    return { trialEndsAt: restored ? restored.trialEndsAt.toISOString() : null };
  }

  async upgradeToPremium(userId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { plan: 'PREMIUM' },
      select: USER_SELECT,
    });
    await this.userCache?.invalidate(userId);
    return user;
  }

  async countMonthlyTrades(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return this.prisma.trade.count({
      where: { userId, createdAt: { gte: startOfMonth } },
    });
  }

  /**
   * Sauvegarde le profil de l'onboarding (étape stratégie) SANS marquer
   * l'onboarding terminé. Le flag `onboardingCompleted` n'est posé qu'à la
   * toute fin du wizard, via {@link finishOnboarding}. Sinon l'overlay
   * disparaît dès la stratégie et les étapes Actifs/Premier trade sont sautées.
   */
  async saveOnboardingProfile(userId: string, dto: CompleteOnboardingDto) {
    // `dto.currency` est ignoré : la devise est celle du compte créé à l'onboarding.
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        market: dto.market ?? null,
        goal: dto.goal ?? null,
        ...(dto.startingCapital != null ? { startingCapital: dto.startingCapital } : {}),
        ...(dto.tradingStyle ? { tradingStyle: dto.tradingStyle } : {}),
        ...(dto.tradingStrategy ? { tradingStrategy: dto.tradingStrategy } : {}),
        ...(dto.tradingSessions ? { tradingSessions: dto.tradingSessions } : {}),
        ...(dto.tradesPerDayMin != null ? { tradesPerDayMin: dto.tradesPerDayMin } : {}),
        ...(dto.tradesPerDayMax != null ? { tradesPerDayMax: dto.tradesPerDayMax } : {}),
        ...(dto.strategyDescription ? { strategyDescription: dto.strategyDescription } : {}),
      },
      select: USER_SELECT,
    });
  }

  /** Marque l'onboarding terminé : appelé uniquement à l'écran final du wizard. */
  async finishOnboarding(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { onboardingCompleted: true },
      select: USER_SELECT,
    });
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
      select: USER_SELECT,
    });
    await this.userCache?.invalidate(userId); // nom relu par le JWT
    return user;
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    // Liste blanche (#1267) : seuls les champs de PREFERENCE_FIELDS partent en base, un par un.
    // Plus de devise globale ni de taux : `currency` n'y est pas, il est ignoré s'il arrive encore.
    const prefs: Partial<Pick<UpdatePreferencesDto, PreferenceField>> = {};
    for (const key of PREFERENCE_FIELDS) {
      if (dto[key] !== undefined) (prefs as Record<PreferenceField, unknown>)[key] = dto[key];
    }
    // Consentement marketing : horodaté quand il CHANGE seulement (preuve RGPD ; le profil le renvoie
    // à chaque enregistrement). Au retrait, la date du consentement reste, celle du retrait s'ajoute (#747). Le réglage (« Conseils, nouveautés et offres ») couvre aussi les
    // conseils de prise en main : l'activer les rétablit, le couper les arrête.
    let consentAt = {};
    if (dto.marketingConsent !== undefined) {
      const current = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { marketingConsent: true },
      });
      if (current?.marketingConsent !== dto.marketingConsent) {
        consentAt = dto.marketingConsent
          ? { marketingConsentAt: new Date(), marketingConsentWithdrawnAt: null, serviceEmailsOptOutAt: null }
          : { marketingConsentWithdrawnAt: new Date(), serviceEmailsOptOutAt: new Date() };
      }
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...prefs, ...consentAt },
      select: USER_SELECT,
    });
  }

  async deleteMe(userId: string, reason?: string): Promise<void> {
    // Corps validé par DeleteMeDto (#1069) ; le garde reste pour les appels internes au service.
    await this.archiveAndDelete(userId, 'self', typeof reason === 'string' ? reason : undefined);
  }

  async adminSubscriptions(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const userSelect = {
      id: true, email: true, name: true, plan: true, role: true,
      trialEndsAt: true, stripeInterval: true, stripeCurrentPeriodEnd: true,
      lastSeenAt: true, lastLoginAt: true, createdAt: true,
    } as const;

    // Abonnés payants = abonnement Stripe `active` (hors démo, #828) : une réservation fondateur ou un
    // essai d'abonnement (`trialing`) ne paie pas encore, il va dans « Essais et offerts ».
    const now = new Date();
    // Hors ADMIN aussi (règle 9 de plans.md) : le KPI « Stripe actifs » et le MRR (REAL_USERS_WHERE)
    // comptent les mêmes comptes.
    const stripeWhere: Prisma.UserWhereInput = { isDemo: false, role: { not: Role.ADMIN }, ...subscriptionStateWhere('paying', now) };
    // Essais et offerts (#828) : essai d'inscription, essai d'abonnement, Premium offert par l'admin.
    const trialWhere: Prisma.UserWhereInput = {
      AND: [{ isDemo: false }, { role: { not: Role.ADMIN } }, subscriptionStatesWhere(['signup_trial', 'subscription_trial', 'offered'], now)],
    };
    // « Accès manuels » (A10 #1065) = Premium sans abonnement ni essai : rôle bêta-testeur (quel que
    // soit le plan) ou plan PREMIUM accordé à la main, mêmes états que subscriptionState. Hors démo et
    // hors ADMIN (l'équipe, déjà hors statistiques). Avant : plan PREMIUM exigé, bêtas FREE absents.
    const manualWhere: Prisma.UserWhereInput = {
      AND: [{ isDemo: false }, { role: { not: Role.ADMIN } }, subscriptionStatesWhere(['role', 'manual'], now)],
    };
    // En pause (past_due / unpaid, A10) : n'apparaissaient nulle part.
    const pausedWhere: Prisma.UserWhereInput = { isDemo: false, role: { not: Role.ADMIN }, ...subscriptionStateWhere('paused', now) };
    const [stripeUsers, stripeTotal, betaTesters, trialUsers, pausedUsers] = await Promise.all([
      this.prisma.user.findMany({
        where: stripeWhere,
        skip,
        take: limit,
        orderBy: { stripeCurrentPeriodEnd: 'desc' },
        // Montant réellement payé (#525) : place fondateur ou code partenaire de l'abonné.
        // Fin programmée et statut (A9 #1065) : un abonné résilié n'est pas « actif, renouvelé le ».
        select: {
          ...userSelect,
          stripeSubscriptionStatus: true,
          stripeCancelAt: true,
          trialSource: true,
          founderSeat: { select: { number: true, status: true } },
          partnerRedemption: {
            select: {
              status: true, priceMonthlyEur: true, priceAnnualEur: true, durationMonths: true, createdAt: true,
              partnerCode: { select: { code: true } },
            },
          },
        },
      }),
      this.prisma.user.count({ where: stripeWhere }),
      this.prisma.user.findMany({
        where: manualWhere,
        orderBy: { createdAt: 'desc' },
        take: TRIAL_LIST_MAX, // borné comme les essais et les pauses (#1102)
        select: userSelect,
      }),
      this.prisma.user.findMany({
        where: trialWhere,
        orderBy: { createdAt: 'desc' },
        take: TRIAL_LIST_MAX,
        select: { ...userSelect, trialSource: true, stripeSubscriptionStatus: true, stripeCancelAt: true },
      }),
      this.prisma.user.findMany({
        where: pausedWhere,
        orderBy: { stripeCurrentPeriodEnd: 'desc' },
        take: TRIAL_LIST_MAX,
        select: { ...userSelect, trialSource: true, stripeSubscriptionStatus: true, stripeCancelAt: true },
      }),
    ]);

    // Objet brut : l'intercepteur global ajoute `{ data }`. L'ancien `{ data: { … } }` donnait
    // `{ data: { data: … } }` et la page admin Abonnements lisait des champs vides (plantage).
    return {
      stripeUsers,
      /** Abonnés payants au total (A8 #1065) : KPI et pagination, `stripeUsers` n'en est qu'une page. */
      stripeTotal,
      betaTesters,
      trialUsers,
      pausedUsers,
      page,
      limit,
    };
  }

  async adminDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, plan: true, role: true,
        trialEndsAt: true, stripeInterval: true, stripeCurrentPeriodEnd: true,
        lastSeenAt: true, lastLoginAt: true, createdAt: true,
        tradingStyle: true, tradingStrategy: true, tradingSessions: true,
        tradesPerDayMin: true, tradesPerDayMax: true, strategyDescription: true,
        market: true, goal: true, startingCapital: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [totalTrades, tradesThisMonth, aiLogs, stats, topAssets] =
      await Promise.all([
        this.prisma.trade.count({ where: { userId } }),
        this.prisma.trade.count({ where: { userId, createdAt: { gte: startOfMonth } } }),
        this.prisma.aiUsageLog
          .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 })
          .catch(() => []),
        // P&L et win rate calculés en base (SCA-B2-04) : plus de chargement de tous les trades.
        closedTradeStats(this.prisma, userId),
        this.prisma.trade.groupBy({
          by: ['asset'],
          where: { userId },
          _count: { asset: true },
          orderBy: { _count: { asset: 'desc' } },
          take: 3,
        }),
      ]);

    const totalPnl      = stats.totalPnl;
    const winRate       = Math.round(stats.winRate);
    const totalTokens   = aiLogs.reduce((a, l) => a + l.inputTokens + l.outputTokens, 0);
    const totalCostUsd  = aiLogs.reduce((a, l) => a + l.costUsd, 0);

    const featureMap = new Map<string, number>();
    for (const l of aiLogs) {
      featureMap.set(l.feature, (featureMap.get(l.feature) ?? 0) + 1);
    }

    const timeline = [
      ...(user.lastLoginAt
        ? [{ action: 'Connexion', detail: '', type: 'auth' as const, createdAt: user.lastLoginAt.toISOString() }]
        : []),
      ...aiLogs.slice(0, 8).map(l => ({
        action: `IA · ${l.feature}`,
        detail: `${(l.inputTokens + l.outputTokens).toLocaleString()} tokens`,
        type: 'ai' as const,
        createdAt: l.createdAt.toISOString(),
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    return {
      user,
      stats: {
        totalTrades, tradesThisMonth, totalPnl, winRate,
        totalAiCalls: aiLogs.length, totalTokens, totalCostUsd,
        byFeature: Object.fromEntries(featureMap),
        monthlyLimit: user.plan === 'FREE' ? 30 : null,
        monthlyPercent: user.plan === 'FREE' ? Math.min(100, Math.round((tradesThisMonth / 30) * 100)) : null,
      },
      topAssets: topAssets.map(a => ({ asset: a.asset, count: a._count.asset })),
      timeline,
    };
  }
}
