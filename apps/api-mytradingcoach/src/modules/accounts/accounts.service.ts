import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PropFirmDrawdownKind, PropFirmPhaseRules } from '@mtc/shared';
import {
  AccountStatus,
  AccountType,
  DrawdownType,
  Plan,
  Role,
  TradingAccount,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { aggregateRuleTrades, EMPTY_RULE_AGG, ruleAggregatesSql, type RuleAgg, type RuleTrade } from './account-rules';

type RuleAccount = Pick<
  TradingAccount,
  'accountSize' | 'startingBalance' | 'profitTarget' | 'maxDrawdown' | 'drawdownType'
> & { type?: AccountType };

/** Plan du catalogue relié au compte : ses règles de drawdown remplacent la saisie manuelle. */
export interface RulePlan {
  firmName: string;
  planName: string;
  accountSize: number;
  phases: PropFirmPhaseRules[];
}

/** Solde et equity du compte lus chez le broker (connexion API), quand il y en a une. */
export interface RuleBroker {
  cashBalance: number | null;
  cashBalanceAt: Date | null;
  netLiq: number | null;
  openPnl: number | null;
  equityAt: Date | null;
  openPositions: number;
}

const BROKER_SELECT = {
  brokerCashBalance: true,
  brokerCashBalanceAt: true,
  brokerNetLiq: true,
  brokerOpenPnl: true,
  brokerEquityAt: true,
  brokerOpenPositions: true,
} as const;

/**
 * Écart solde broker ↔ solde MTC au-delà duquel le solde de départ saisi n'est visiblement pas
 * dans le même référentiel que le broker (ex. funded saisi à 0 $, compte à 50 000 $ chez le
 * broker). On garde alors le calcul MTC et on n'ajoute que le latent du broker. En deçà, l'écart
 * vient de trades ou de frais manquants : le solde du broker fait foi.
 */
export function brokerReferenceMismatch(gap: number, reference: number): boolean {
  return Math.abs(gap) > Math.max(2_000, 0.25 * Math.abs(reference));
}

const PLAN_SELECT = {
  planName: true,
  accountSize: true,
  phases: true,
  firm: { select: { name: true } },
} as const;

/** Contexte plan du user pour le calcul du quota de comptes. */
type PlanContext = { plan: Plan; role: Role; trialEndsAt?: Date | null };

// Quota de comptes par plan : aligné front `ACCOUNT_LIMITS` (pricing.const.ts).
// Premium / trial / admin / beta = illimité. Seuls les comptes ACTIVE consomment un
// slot (PASSED / FAILED / ARCHIVED le libèrent).
const FREE_ACCOUNT_LIMIT = 1;

const BROKER_DISCLAIMER =
  "Solde et positions ouvertes lus chez le broker ; seuil de drawdown calculé par MyTradingCoach, " +
  "pas celui de la prop firm. Le statut du compte reste piloté par toi.";

const RULE_DISCLAIMER =
  "Estimation basée uniquement sur les trades loggés dans MyTradingCoach, pas " +
  "l'equity temps réel ni le calcul officiel de la prop firm (positions ouvertes, " +
  "fuseau, trailing intraday). Le statut du compte reste piloté par toi.";

/** Règle officielle appliquée au drawdown (compte relié à un plan du catalogue). */
export interface DrawdownPlanRule {
  firmName: string;
  planName: string;
  phase: PropFirmPhaseRules['phase'];
  kind: PropFirmDrawdownKind;
  /** Solde (référentiel du compte) qui fige le seuil ; null = pas de verrouillage chiffré. */
  locksAt: number | null;
  lockedFloor: number | null;
  locked: boolean;
  /** La firm contrôle le seuil en temps réel, positions ouvertes comprises. */
  realtimeEquity: boolean;
}

export interface AccountRuleMetrics {
  startingBalance: number;
  realizedPnl: number;
  currentBalance: number;
  tradesCount: number;
  winRate: number | null; // ratio 0..1 des trades gagnants (pnl > 0), null si 0 trade
  bestDay: number | null; // meilleur PnL journalier cumulé, en $, null si 0 trade
  worstDay: number | null; // pire PnL journalier cumulé, en $, null si 0 trade
  objective: { current: number; target: number; pct: number } | null;
  drawdown: {
    type: DrawdownType;
    floor: number;
    margin: number;
    maxDrawdown: number;
    pct: number;
    breached: boolean;
    /** `plan` : règles officielles du plan relié ; `manual` : montant et type saisis. */
    source: 'plan' | 'manual';
    rule: DrawdownPlanRule | null;
  } | null;
  /** Plan relié dont le montant de drawdown n'est pas publié : aucun chiffre affiché. */
  drawdownUnconfirmed: boolean;
  /**
   * Solde et equity lus chez le broker. Présent → `currentBalance` est le solde du broker et la
   * marge de drawdown se calcule sur l'equity (latent compris), sauf `referenceMismatch`.
   */
  broker: {
    cashBalance: number;
    equity: number;
    openPnl: number;
    openPositions: number;
    balanceAt: Date | null;
    equityAt: Date | null;
    /** Solde de départ saisi incompatible avec le solde du broker : calcul MTC + latent. */
    referenceMismatch: boolean;
  } | null;
  estimated: true;
  disclaimer: string;
}

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liste des comptes du user (actifs d'abord, archivés ensuite), chacun enrichi de ses
   * métriques « règles prop firm » estimées à partir des trades loggés (cf. computeRuleMetrics).
   */
  async list(
    userId: string,
  ): Promise<(TradingAccount & { metrics: AccountRuleMetrics })[]> {
    // Ordre enum Postgres = ordre de déclaration (ACTIVE < PASSED < FAILED < ARCHIVED).
    const rows = await this.prisma.tradingAccount.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      include: {
        propFirmPlan: { select: PLAN_SELECT },
        brokerConnections: { where: { brokerCashBalance: { not: null } }, select: BROKER_SELECT, take: 1 },
      },
    });
    if (rows.length === 0) return [];
    const accounts = rows.map(({ propFirmPlan, brokerConnections, ...a }) => ({
      account: a,
      plan: toRulePlan(propFirmPlan),
      broker: toRuleBroker(brokerConnections[0] ?? null),
    }));

    // Agrégats de tous les comptes en UNE requête SQL (SCA-B2-03) : avant, tous les trades
    // fermés du user étaient chargés puis groupés en mémoire.
    const aggs = await ruleAggregatesSql(this.prisma, userId, accounts.map(({ account }) => account.id));

    return accounts.map(({ account, plan, broker }) => ({
      ...account,
      metrics: this.ruleMetricsFromAgg(account, aggs.get(account.id) ?? EMPTY_RULE_AGG, plan, broker),
    }));
  }

  private clamp01(x: number): number {
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  /**
   * Métriques « règles prop firm » ESTIMÉES à partir des trades fermés (pnl net) triés par
   * tradedAt. Objectif (vs profitTarget) + marge avant drawdown selon STATIC/TRAILING.
   * Honnêteté : `estimated: true` + `disclaimer` que le front DOIT afficher. Aucun statut
   * PASSED/FAILED positionné ici (piloté par l'user) : on se contente d'estimer.
   */
  computeRuleMetrics(
    account: RuleAccount,
    trades: RuleTrade[],
    plan: RulePlan | null = null,
    broker: RuleBroker | null = null,
  ): AccountRuleMetrics {
    return this.ruleMetricsFromAgg(account, aggregateRuleTrades(trades), plan, broker);
  }

  /** Mise en forme des métriques à partir des agrégats (calculés en SQL par `list`, ou en JS). */
  ruleMetricsFromAgg(
    account: RuleAccount,
    agg: RuleAgg,
    plan: RulePlan | null = null,
    brokerData: RuleBroker | null = null,
  ): AccountRuleMetrics {
    const phase = plan ? phaseFor(plan, account.type) : null;
    const startingBalance =
      account.startingBalance ?? account.accountSize ?? (phase && plan ? phase.starting_balance ?? plan.accountSize : 0);
    const tradesBalance = startingBalance + agg.realized;

    // Solde du broker : il fait foi (trades ou frais manquants côté MTC), sauf référentiel
    // incompatible avec le solde de départ saisi. L'equity ajoute le latent du dernier instantané
    // tant qu'une position est ouverte ; sans position, l'equity EST le solde.
    let broker: AccountRuleMetrics['broker'] = null;
    if (brokerData?.cashBalance != null) {
      const referenceMismatch = brokerReferenceMismatch(
        brokerData.cashBalance - tradesBalance,
        account.accountSize ?? startingBalance,
      );
      const open = brokerData.openPositions > 0;
      const openPnl = open ? brokerData.openPnl ?? 0 : 0;
      const cashBalance = referenceMismatch ? tradesBalance : brokerData.cashBalance;
      const equity = !referenceMismatch && open && brokerData.netLiq != null ? brokerData.netLiq : cashBalance + openPnl;
      broker = {
        cashBalance: brokerData.cashBalance,
        equity,
        openPnl,
        openPositions: brokerData.openPositions,
        balanceAt: brokerData.cashBalanceAt,
        equityAt: brokerData.equityAt,
        referenceMismatch,
      };
    }
    const currentBalance = broker && !broker.referenceMismatch ? broker.cashBalance : tradesBalance;
    const realizedPnl = currentBalance - startingBalance;
    /** Valeur comparée au plancher : l'equity du broker (latent compris) quand on l'a. */
    const equity = broker ? broker.equity : currentBalance;

    // Taux de réussite (BE exclus du dénominateur) : RATIO 0..1, null si aucun trade décisif.
    const winRate = agg.wins + agg.losses > 0 ? agg.wins / (agg.wins + agg.losses) : null;

    const objective =
      account.profitTarget != null && account.profitTarget > 0
        ? {
            current: realizedPnl,
            target: account.profitTarget,
            pct: this.clamp01(realizedPnl / account.profitTarget),
          }
        : null;

    let drawdown: AccountRuleMetrics['drawdown'] = null;
    let drawdownUnconfirmed = false;
    if (phase && plan) {
      const md = phase.max_drawdown;
      if (md.amount == null || !(md.amount > 0)) {
        drawdownUnconfirmed = true;
      } else {
        // Seuils du catalogue exprimés depuis le solde de départ de la phase : on les décale sur
        // celui du compte (reprise du suivi en cours de route, solde saisi différent).
        const shift = startingBalance - (phase.starting_balance ?? plan.accountSize);
        // Intraday : un nouveau plus haut en direct (equity du broker) fait monter le seuil.
        const peakProfit =
          md.type === 'trailing_eod' ? Math.max(0, agg.maxEodCumulative)
          : md.type === 'trailing_intraday' ? Math.max(0, agg.maxCumulative, equity - startingBalance)
          : 0;
        const locksAt = md.locks_at != null ? md.locks_at + shift : null;
        const lockedFloor = md.locked_floor != null ? md.locked_floor + shift : null;
        const locked = md.type !== 'static' && locksAt != null && startingBalance + peakProfit >= locksAt;
        const floor = locked
          ? lockedFloor ?? locksAt! - md.amount
          : startingBalance + peakProfit - md.amount;
        const margin = equity - floor;
        drawdown = {
          type: md.type === 'static' ? DrawdownType.STATIC : DrawdownType.TRAILING,
          floor,
          margin,
          maxDrawdown: md.amount,
          pct: this.clamp01(margin / md.amount),
          breached: margin <= 0,
          source: 'plan',
          rule: {
            firmName: plan.firmName,
            planName: plan.planName,
            phase: phase.phase,
            kind: md.type,
            locksAt,
            lockedFloor: locksAt != null ? lockedFloor ?? locksAt - md.amount : null,
            locked,
            realtimeEquity: md.enforced_on === 'equity_realtime',
          },
        };
      }
    } else if (account.maxDrawdown != null && account.maxDrawdown > 0) {
      // TRAILING : plancher glissant sous le plus haut solde atteint (hwm, qui part du solde de
      // départ) ; STATIC : plancher fixe depuis le solde de départ.
      const floor =
        account.drawdownType === DrawdownType.TRAILING
          ? startingBalance + Math.max(0, agg.maxCumulative, equity - startingBalance) - account.maxDrawdown
          : startingBalance - account.maxDrawdown;
      const margin = equity - floor;
      drawdown = {
        type: account.drawdownType,
        floor,
        margin,
        maxDrawdown: account.maxDrawdown,
        pct: this.clamp01(margin / account.maxDrawdown),
        breached: margin <= 0,
        source: 'manual',
        rule: null,
      };
    }

    return {
      startingBalance,
      realizedPnl,
      currentBalance,
      tradesCount: agg.count,
      winRate,
      bestDay: agg.count ? agg.bestDay : null,
      worstDay: agg.count ? agg.worstDay : null,
      objective,
      drawdown,
      drawdownUnconfirmed,
      broker,
      estimated: true,
      disclaimer: drawdown?.rule ? planDisclaimer(drawdown.rule, broker) : broker ? BROKER_DISCLAIMER : RULE_DISCLAIMER,
    };
  }

  /**
   * Quota de comptes du plan : `null` = illimité.
   * Premium / trial / admin / beta → illimité · Free → 1.
   * Sans contexte (appels internes) → non plafonné.
   */
  private resolveAccountLimit(ctx?: PlanContext): number | null {
    if (!ctx) return null;
    const { plan, role, trialEndsAt } = ctx;
    if (role === Role.ADMIN || role === Role.BETA_TESTER) return null;
    const inTrial = !!(trialEndsAt && new Date() < new Date(trialEndsAt));
    if (plan === Plan.PREMIUM || inTrial) return null;
    return FREE_ACCOUNT_LIMIT;
  }

  /**
   * Vérifie qu'un slot est disponible avant d'ouvrir un compte ACTIVE.
   * Règle de slot : seuls les comptes ACTIVE consomment le quota ; PASSED, FAILED et
   * ARCHIVED libèrent leur slot (un éval terminé/cramé ne bloque pas une création).
   * Throw `ACCOUNT_LIMIT_REACHED` si la limite du plan serait dépassée.
   */
  private async assertActiveSlotAvailable(
    userId: string,
    ctx?: PlanContext,
  ): Promise<void> {
    const limit = this.resolveAccountLimit(ctx);
    if (limit === null) return;
    const activeCount = await this.prisma.tradingAccount.count({
      where: { userId, status: AccountStatus.ACTIVE },
    });
    if (activeCount >= limit) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LIMIT_REACHED',
        limit,
        message: `Limite de ${limit} compte(s) atteinte pour ton plan. Passe à un plan supérieur pour en ajouter.`,
      });
    }
  }

  async create(
    userId: string,
    dto: CreateAccountDto,
    ctx?: PlanContext,
  ): Promise<TradingAccount> {
    // Un compte créé est ACTIVE par défaut → il consomme un slot.
    await this.assertActiveSlotAvailable(userId, ctx);
    if (dto.propFirmPlanId) await this.assertCatalogPlan(dto.propFirmPlanId);
    return this.prisma.tradingAccount.create({ data: { userId, ...dto } });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAccountDto,
    ctx?: PlanContext,
  ): Promise<TradingAccount> {
    const account = await this.assertOwner(userId, id);
    // Réactivation (passage à ACTIVE depuis PASSED/FAILED/ARCHIVED) : revérifier le
    // quota AVANT d'appliquer (anti-bypass archiver→créer→désarchiver). Les updates
    // qui ne rendent pas le compte ACTIVE ne sont pas concernés.
    if (dto.status === AccountStatus.ACTIVE && account.status !== AccountStatus.ACTIVE) {
      await this.assertActiveSlotAvailable(userId, ctx);
    }
    // La devise d'un compte synchronisé vient du broker : non modifiable ici.
    if (dto.currency !== undefined && dto.currency !== account.currency) {
      const synced = await this.prisma.brokerConnection.count({ where: { accountId: id } });
      if (synced > 0) {
        throw new BadRequestException(
          "La devise d'un compte synchronisé vient du broker : elle ne se modifie pas.",
        );
      }
    }
    if (dto.propFirmPlanId && dto.propFirmPlanId !== account.propFirmPlanId) {
      await this.assertCatalogPlan(dto.propFirmPlanId);
    }
    return this.prisma.tradingAccount.update({ where: { id }, data: dto });
  }

  /**
   * Un compte ne se relie qu'à un plan ACTIF du catalogue. Sans ce contrôle, un id inconnu
   * finirait en violation de FK (500) ; un plan retiré reste lisible sur les comptes qui le
   * portaient déjà, mais ne se choisit plus.
   */
  private async assertCatalogPlan(planId: string): Promise<void> {
    const found = await this.prisma.propFirmPlan.count({ where: { id: planId, active: true } });
    if (!found) {
      throw new BadRequestException("Ce plan n'existe pas ou n'est plus proposé par la prop firm.");
    }
  }

  /**
   * Suppression : hard delete si le compte est vide, sinon archivage (l'historique
   * reste rattaché au compte archivé). On refuse d'archiver le DERNIER compte actif
   * portant de l'historique, pour ne jamais laisser le user sans compte actif où
   * rattacher ses prochains trades (cf. défaut anti-NULL de l'ÉTAPE 4).
   */
  async remove(
    userId: string,
    id: string,
  ): Promise<{ deleted?: boolean; archived?: boolean }> {
    const account = await this.assertOwner(userId, id);

    const [tradeCount, sessionCount] = await Promise.all([
      this.prisma.trade.count({ where: { accountId: id } }),
      this.prisma.tradeSession.count({ where: { accountId: id } }),
    ]);
    const hasHistory = tradeCount > 0 || sessionCount > 0;

    if (!hasHistory) {
      await this.prisma.tradingAccount.delete({ where: { id } });
      return { deleted: true };
    }

    if (account.status === AccountStatus.ACTIVE) {
      const activeCount = await this.prisma.tradingAccount.count({
        where: { userId, status: AccountStatus.ACTIVE },
      });
      if (activeCount <= 1) {
        throw new BadRequestException(
          "Garde au moins un compte actif. Crée-en un autre avant d'archiver celui-ci.",
        );
      }
    }

    await this.prisma.tradingAccount.update({
      where: { id },
      data: { status: AccountStatus.ARCHIVED },
    });
    return { archived: true };
  }

  /**
   * Helper de filtre lecture réutilisable. `accountId` absent ou 'all' → fragment vide
   * (agrégé, comportement actuel). Sinon vérifie l'appartenance au user (sinon 404) et
   * renvoie `{ accountId }` à fusionner dans un `where` Prisma.
   */
  async accountWhere(
    userId: string,
    accountId?: string,
  ): Promise<{ accountId?: string }> {
    if (!accountId || accountId === 'all') return {};
    const account = await this.prisma.tradingAccount.findUnique({
      where: { id: accountId },
      select: { userId: true },
    });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Compte introuvable.');
    }
    return { accountId };
  }

  /**
   * Compte par défaut (anti-NULL) pour une écriture sans accountId explicite :
   * le « Compte principal » actif, sinon le compte actif le plus récent, sinon on
   * CRÉE le « Compte principal ». Renvoie toujours un id (jamais NULL).
   * (Les comptes démo sont read-only, bloqués en amont par DemoReadOnlyGuard.)
   */
  async ensureDefaultAccountId(userId: string): Promise<string> {
    const principal = await this.prisma.tradingAccount.findFirst({
      where: { userId, status: AccountStatus.ACTIVE, label: 'Compte principal' },
      select: { id: true },
    });
    if (principal) return principal.id;

    const recent = await this.prisma.tradingAccount.findFirst({
      where: { userId, status: AccountStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (recent) return recent.id;

    // Premier compte cree implicitement (import onboarding) : herite du capital declare au
    // profil, sinon le dashboard afficherait « base 0 » alors que l'utilisateur a saisi un capital.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { startingCapital: true },
    });
    const startingBalance =
      user?.startingCapital && user.startingCapital > 0 ? user.startingCapital : null;

    const created = await this.prisma.tradingAccount.create({
      data: { userId, label: 'Compte principal', startingBalance },
      select: { id: true },
    });
    return created.id;
  }

  /** Vérifie que le compte existe ET appartient au user (sinon 404, sans fuite d'existence). */
  private async assertOwner(
    userId: string,
    id: string,
  ): Promise<TradingAccount> {
    const account = await this.prisma.tradingAccount.findUnique({ where: { id } });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Compte introuvable.');
    }
    return account;
  }
}

/** Phase du plan qui s'applique au type de compte : évaluation, ou funded (sinon direct). */
function phaseFor(plan: RulePlan, type: AccountType | undefined): PropFirmPhaseRules | null {
  if (type === AccountType.EVALUATION) return plan.phases.find((p) => p.phase === 'evaluation') ?? null;
  if (type === AccountType.FUNDED) {
    return plan.phases.find((p) => p.phase === 'funded') ?? plan.phases.find((p) => p.phase === 'direct') ?? null;
  }
  return null;
}

function toRulePlan(
  row: { planName: string; accountSize: number; phases: unknown; firm: { name: string } } | null,
): RulePlan | null {
  if (!row || !Array.isArray(row.phases)) return null;
  return { firmName: row.firm.name, planName: row.planName, accountSize: row.accountSize, phases: row.phases as PropFirmPhaseRules[] };
}

function planDisclaimer(rule: DrawdownPlanRule, broker: AccountRuleMetrics['broker']): string {
  const kind =
    rule.kind === 'trailing_eod' ? 'trailing sur le plus haut solde de fin de journée'
    : rule.kind === 'trailing_intraday' ? 'trailing sur le plus haut atteint en séance'
    : 'statique';
  const live = broker && !broker.referenceMismatch;
  return (
    `Drawdown calculé avec les règles officielles ${rule.firmName} · ${rule.planName} (${kind}), ` +
    (live
      ? 'appliquées au solde et aux positions ouvertes lus chez le broker.'
      : 'appliquées à tes trades loggés dans MyTradingCoach.') +
    (rule.realtimeEquity && !broker
      ? ` ${rule.firmName} contrôle ce seuil en temps réel, positions ouvertes comprises : elles ne sont pas incluses ici.`
      : '') +
    (rule.kind === 'trailing_intraday' ? ' Les pics atteints pendant un trade ouvert ne sont pas tous connus : le seuil réel peut être plus haut.' : '') +
    ' Les payouts ne sont pas suivis. Le statut du compte reste piloté par toi.'
  );
}

function toRuleBroker(row: {
  brokerCashBalance: number | null; brokerCashBalanceAt: Date | null; brokerNetLiq: number | null;
  brokerOpenPnl: number | null; brokerEquityAt: Date | null; brokerOpenPositions: number;
} | null): RuleBroker | null {
  if (!row || row.brokerCashBalance == null) return null;
  return {
    cashBalance: row.brokerCashBalance,
    cashBalanceAt: row.brokerCashBalanceAt,
    netLiq: row.brokerNetLiq,
    openPnl: row.brokerOpenPnl,
    equityAt: row.brokerEquityAt,
    openPositions: row.brokerOpenPositions,
  };
}

