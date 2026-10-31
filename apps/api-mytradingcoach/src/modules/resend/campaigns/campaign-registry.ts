import { AccountStatus, AccountType, BrokerConnectionStatus, Plan, PlanLinkChoice, Prisma, Role, TrialSource } from '@prisma/client';
import { formatMoney } from '@mtc/shared';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  CampaignBuildCtx,
  CampaignContent,
  announcementTemplate,
  connectTradovateTemplate,
  discordTemplate,
  firstTradeTemplate,
  firstWeekRecapTemplate,
  founderFollowupTemplate,
  founderLaunchTemplate,
  premiumTemplate,
  profileTemplate,
  propFirmRulesTemplate,
  reengagementTemplate,
  trialEndedTemplate,
  trialEndingTemplate,
} from './campaign-templates';

/**
 * transactional : jamais filtré ni plafonné · marketing : consentement + plafond · service : aide à
 * la prise en main (intérêt légitime), sans consentement mais avec désinscription propre
 * (`serviceEmailsOptOutAt`) et le MÊME plafond que le marketing.
 */
export type CampaignKind = 'transactional' | 'marketing' | 'service';

/** Ce dont `loadContext` a besoin, fourni par le cron et l'admin. */
export interface CampaignLoadDeps {
  prisma: PrismaService;
  founderState: () => Promise<{ open: boolean; seatsLeft: number; seatsTotal: number }>;
}

/** Données propres à chaque destinataire ; un id ABSENT de la Map = e-mail sans objet, pas d'envoi. */
export type CampaignContextMap = Map<string, Partial<CampaignBuildCtx>>;

export interface EmailCampaign {
  key: string;
  label: string;
  description: string;
  kind: CampaignKind;
  requiresConsent: boolean; // marketing => true par défaut
  automated: boolean; // true => envoyé par le cron
  priority: number; // plus haut = plus prioritaire
  recurringCooldownDays?: number; // si défini => recurring, sinon oneShot
  // where Prisma calculé dynamiquement (bornes temporelles relatives à "now")
  segment: (now: Date) => Prisma.UserWhereInput;
  /**
   * Données lues au moment de l'envoi, pour une PAGE de destinataires déjà autorisés (≤ 500) :
   * requêtes groupées, jamais une requête par personne.
   */
  loadContext?: (deps: CampaignLoadDeps, userIds: string[], now: Date) => Promise<CampaignContextMap>;
  // construit l'email pour un user donné
  build: (ctx: CampaignBuildCtx) => CampaignContent;
}

const DAY = 24 * 3600e3;

/**
 * Fenêtre d'âge du compte : inscrit depuis `minDays` à `maxDays` jours. Toute campagne automatique
 * en a une : un ancien inscrit ne reçoit jamais d'un coup une relance pensée pour ses premiers jours.
 */
export function ageWindow(now: Date, minDays: number, maxDays: number): Prisma.UserWhereInput {
  return {
    createdAt: {
      gte: new Date(now.getTime() - maxDays * DAY),
      lte: new Date(now.getTime() - minDays * DAY),
    },
  };
}

/**
 * Date de démarrage de la suite d'onboarding (`ONBOARDING_SEQUENCE_START`, date ISO) : seuls les
 * inscrits APRÈS la mise en prod entrent dans les nouvelles campagnes. Absente ou invalide → la
 * suite ne cible personne (le cron le signale).
 */
export function onboardingStart(): Date | null {
  const raw = process.env['ONBOARDING_SEQUENCE_START'];
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

const NEVER = new Date('9999-12-31T00:00:00Z');
const sinceOnboardingStart = (): Prisma.UserWhereInput => ({ createdAt: { gte: onboardingStart() ?? NEVER } });

const noTrade: Prisma.UserWhereInput = { trades: { none: {} } };

/**
 * Hors Premium sans abonnement en cours (essai d'inscription ou Premium offert, #769) : le plan reste
 * FREE pendant l'essai, mais une relance « passe Premium » n'a pas de sens pour qui l'a déjà.
 */
export const notInTrial = (now: Date): Prisma.UserWhereInput => ({
  OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }],
});

/** Mêmes exclusions que founder_launch : abonnés payants, fondateurs, codes partenaires, bêta. */
const founderTargets: Prisma.UserWhereInput = {
  AND: [
    { role: { not: Role.BETA_TESTER } },
    { OR: [{ stripeSubscriptionStatus: null }, { stripeSubscriptionStatus: { notIn: ['active', 'past_due'] } }] },
    { founderSeat: { is: null } },
    { NOT: { partnerRedemption: { is: { status: 'ACTIVE' } } } },
  ],
};

/** Nombre de prop firms du catalogue, identique pour toute la page. */
async function loadPropFirmCount(deps: CampaignLoadDeps, userIds: string[]): Promise<CampaignContextMap> {
  const propFirmCount = await deps.prisma.propFirm.count();
  return new Map(userIds.map((id) => [id, { propFirmCount }]));
}

/**
 * Bilan J0–J7 depuis l'inscription, en UNE requête pour la page : trades clôturés, jours de trading
 * (journées de Paris), P&L net (même arrondi que les stats). Sans trade sur ces 7 jours → absent.
 */
export async function loadFirstWeek(deps: CampaignLoadDeps, userIds: string[]): Promise<CampaignContextMap> {
  if (userIds.length === 0) return new Map();
  const rows = await deps.prisma.$queryRaw<
    { userId: string; trades: number; days: number; net: number; currencies: string[] }[]
  >(Prisma.sql`
    SELECT t."userId",
           count(*)::int AS "trades",
           count(DISTINCT ((t."tradedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date)::int AS "days",
           coalesce(sum(round((t."pnl" - abs(coalesce(t."commission", 0)))::text::numeric, 2)), 0)::float8 AS "net",
           array_agg(DISTINCT coalesce(a."currency", 'USD')) AS "currencies"
      FROM "Trade" t
      JOIN "User" u ON u."id" = t."userId"
      LEFT JOIN "TradingAccount" a ON a."id" = t."accountId"
     WHERE t."userId" IN (${Prisma.join(userIds)})
       AND t."pnl" IS NOT NULL
       AND t."tradedAt" >= u."createdAt"
       AND t."tradedAt" < u."createdAt" + interval '7 days'
     GROUP BY t."userId"`);
  return new Map(
    rows
      .filter((r) => r.trades > 0)
      .map((r) => {
        // Devises différentes : montant sans symbole (jamais de conversion ni de symbole deviné).
        const currency = r.currencies.length === 1 ? r.currencies[0] : null;
        return [r.userId, { firstWeek: { trades: r.trades, days: r.days, pnl: formatMoney(r.net, currency) } }];
      }),
  );
}

/** Ni abonné Stripe en cours, ni réservation fondateur : le Premium offert est le seul accès. */
const noStripeSubscription: Prisma.UserWhereInput = {
  OR: [{ stripeSubscriptionStatus: null }, { stripeSubscriptionStatus: { notIn: ['active', 'trialing', 'past_due'] } }],
};

/** Essai d'inscription qui se termine (#769, B2) : date de fin, une lecture pour la page. */
export async function loadTrialEnd(deps: CampaignLoadDeps, userIds: string[]): Promise<CampaignContextMap> {
  if (userIds.length === 0) return new Map();
  const users = await deps.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, signupTrialEndsAt: true } });
  return new Map(
    users.filter((u) => u.signupTrialEndsAt).map((u) => [u.id, { trial: { endsAt: u.signupTrialEndsAt! } }]),
  );
}

/** Offre fondateur vérifiée AU MOMENT de l'envoi : fermée ou complète → personne. */
async function loadFounderSeats(deps: CampaignLoadDeps, userIds: string[]): Promise<CampaignContextMap> {
  const state = await deps.founderState();
  if (!state.open || state.seatsLeft <= 0) return new Map();
  return new Map(userIds.map((id) => [id, { seatsLeft: state.seatsLeft, seatsTotal: state.seatsTotal }]));
}

export const CAMPAIGNS: EmailCampaign[] = [
  // ── Automatisées (cron) : suite d'onboarding, 1 e-mail max / 4 jours (plafond) ─────────────────
  // Essai d'inscription (#769, B2) : priorités les plus hautes, fenêtres bornées par la fin de l'essai
  // (pas par l'inscription : un essai offert plus tard par le script de relance compte aussi). J+11
  // part entre 3 jours avant la fin et la fin ; l'e-mail de fin part le lendemain de la fin au plus
  // tôt, donc 4 jours après J+11 : le plafond est respecté sans exception.
  {
    key: 'trial_ending',
    label: 'Fin du Premium offert dans 3 jours (J+11)',
    description: "Service\u00a0: date de fin de l'essai d'inscription et ce qui change en gratuit, rien n'est prélevé.",
    kind: 'service',
    requiresConsent: false,
    automated: true,
    priority: 120,
    segment: (now) => ({
      AND: [
        { trialSource: TrialSource.SIGNUP },
        { signupTrialEndsAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY) } },
        { trialEndsAt: { lte: new Date(now.getTime() + 3 * DAY) } }, // pas prolongé par l'admin
        noStripeSubscription,
      ],
    }),
    loadContext: loadTrialEnd,
    build: trialEndingTemplate,
  },
  {
    key: 'trial_ended',
    label: 'Premium offert terminé (J+15)',
    description: "Service\u00a0: l'essai d'inscription est terminé, retour au gratuit sans rien perdre.",
    kind: 'service',
    requiresConsent: false,
    automated: true,
    priority: 110,
    segment: (now) => ({
      AND: [
        { trialSource: TrialSource.SIGNUP },
        // Au plus tôt le lendemain de la fin (le cron passe à 10 h, la fin tombe à l'heure d'inscription).
        { signupTrialEndsAt: { gte: new Date(now.getTime() - 6 * DAY), lte: new Date(now.getTime() - 15 * 3600e3) } },
        { plan: Plan.FREE },
        noStripeSubscription,
      ],
    }),
    build: trialEndedTemplate,
  },
  {
    key: 'connect_tradovate',
    label: 'Connecter Tradovate (J+1)',
    description: 'Aide : relier Tradovate, pour les inscrits sans connexion broker active ni trade.',
    kind: 'service',
    requiresConsent: false,
    automated: true,
    priority: 100,
    segment: (now) => ({
      AND: [
        sinceOnboardingStart(),
        ageWindow(now, 1, 14),
        noTrade,
        { brokerConnections: { none: { status: BrokerConnectionStatus.CONNECTED } } },
      ],
    }),
    build: connectTradovateTemplate,
  },
  {
    key: 'prop_firm_rules',
    label: 'Choisir sa firme et son plan (J+4)',
    description: 'Aide : relier un compte prop firm (évaluation ou financé) au plan de sa firme.',
    kind: 'service',
    requiresConsent: false,
    automated: true,
    priority: 90,
    segment: (now) => ({
      AND: [
        sinceOnboardingStart(),
        ageWindow(now, 4, 21),
        {
          tradingAccounts: {
            some: {
              status: AccountStatus.ACTIVE,
              type: { notIn: [AccountType.PERSONAL, AccountType.DEMO] },
              propFirmPlanId: null,
              // « Compte perso » ou « firm absente du catalogue » : déjà répondu, rien à proposer.
              OR: [{ planLinkChoice: null }, { planLinkChoice: PlanLinkChoice.LATER }],
            },
          },
        },
      ],
    }),
    loadContext: loadPropFirmCount,
    build: propFirmRulesTemplate,
  },
  {
    key: 'first_week_recap',
    label: 'Bilan de la 1re semaine (J+7)',
    description: 'Bilan J0-J7 des inscrits FREE qui ont tradé, puis ce que Premium ajoute.',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 80,
    segment: (now) => ({
      AND: [sinceOnboardingStart(), ageWindow(now, 7, 14), { plan: Plan.FREE }, notInTrial(now), { trades: { some: {} } }],
    }),
    loadContext: loadFirstWeek,
    build: firstWeekRecapTemplate,
  },
  {
    key: 'founder_followup',
    label: 'Offre fondateur (J+10)',
    description: "Présente l'offre fondateur aux FREE non abonnés qui n'ont pas reçu le lancement.",
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 60,
    segment: (now) => ({
      AND: [
        sinceOnboardingStart(),
        ageWindow(now, 10, 30),
        { plan: Plan.FREE },
        notInTrial(now),
        founderTargets,
        { emailSends: { none: { campaignKey: 'founder_launch' } } },
      ],
    }),
    loadContext: loadFounderSeats,
    build: founderFollowupTemplate,
  },
  {
    key: 'profile_reminder',
    label: 'Profil stratégie (J+3)',
    description: 'Rappelle de remplir le profil stratégie (inscrits de 3 à 14 jours, sans profil).',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 45,
    segment: (now) => ({ AND: [{ tradingStyle: null }, ageWindow(now, 3, 14)] }),
    build: profileTemplate,
  },
  {
    key: 'discord_invite',
    label: 'Invitation Discord (J+5)',
    description: 'Invite les users sans Discord lié (inscrits de 5 à 21 jours).',
    kind: 'marketing',
    requiresConsent: true,
    automated: true,
    priority: 40,
    segment: (now) => ({ AND: [{ discordId: null }, ageWindow(now, 5, 21)] }),
    build: discordTemplate,
  },

  // ── Manuelles (automated: false) : exposées à l'admin, jamais au cron ─────
  {
    // Remplacée dans la suite automatique par connect_tradovate ; gardée pour l'admin.
    key: 'first_trade_nudge',
    label: 'Premier trade',
    description: 'Relance les inscrits de 1 à 14 jours sans aucun trade.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 100,
    segment: (now) => ({ AND: [noTrade, ageWindow(now, 1, 14)] }),
    build: firstTradeTemplate,
  },
  {
    key: 'premium_upsell',
    label: 'Passe à Premium',
    description: 'Incite les FREE actifs à passer Premium.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 30,
    segment: (now) => ({
      AND: [
        { plan: Plan.FREE },
        notInTrial(now),
        { trades: { some: { tradedAt: { gte: new Date(now.getTime() - 14 * DAY) } } } },
      ],
    }),
    build: premiumTemplate,
  },
  {
    key: 'debrief_reminder',
    label: 'Débrief prêt',
    description: 'Notifie les Premium que le débrief hebdo est disponible.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 25,
    segment: () => ({ plan: 'PREMIUM' }),
    build: ({ userName, appUrl, unsubUrl }) =>
      announcementTemplate(
        { userName, appUrl, unsubUrl },
        {
          subject: '📅 Ton débrief hebdo est prêt',
          bodyHtml: `<p style="font-family:'Inter',Arial,sans-serif;font-size:14px;color:#9db4ce;margin:0 0 16px 0;line-height:1.7;">Ton analyse de la semaine vient d'être générée : tes patterns, tes points forts et 3 objectifs concrets pour la semaine.</p>`,
        },
      ),
  },
  {
    key: 'reengagement',
    label: "Tu n'as pas tradé",
    description: 'Réengage les users sans trade depuis 7 jours.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 20,
    segment: (now) => ({
      trades: { none: { tradedAt: { gte: new Date(now.getTime() - 7 * DAY) } } },
    }),
    build: reengagementTemplate,
  },
  {
    // Lancement de l'offre fondateur (#525) : une seule fois par personne, consentement requis.
    // Exclus : abonnés payants, fondateurs (même tarif perdu), codes partenaires actifs, bêta-testeurs.
    // Un essai Stripe ou un mois offert reste ciblé : il peut basculer au tarif fondateur.
    key: 'founder_launch',
    label: 'Offre fondateur (lancement)',
    description: "Annonce l'ouverture de l'offre fondateur aux inscrits non abonnés.",
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 50,
    segment: () => founderTargets,
    build: founderLaunchTemplate,
  },
  {
    key: 'announcement',
    label: 'Annonce / Nouveauté',
    description: 'Annonce libre envoyée aux users consentants.',
    kind: 'marketing',
    requiresConsent: true,
    automated: false,
    priority: 10,
    segment: () => ({}),
    build: (ctx) => announcementTemplate(ctx),
  },
];

export const CAMPAIGNS_BY_KEY = new Map(CAMPAIGNS.map((c) => [c.key, c]));