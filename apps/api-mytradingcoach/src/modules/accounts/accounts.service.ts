import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  DrawdownType,
  Plan,
  Role,
  TradingAccount,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

type RuleTrade = { pnl: number | null; tradedAt: Date };

/** Contexte plan du user pour le calcul du quota de comptes. */
type PlanContext = { plan: Plan; role: Role; trialEndsAt?: Date | null };

// Quota de comptes par plan — aligné front `ACCOUNT_LIMITS` (pricing.const.ts).
// Premium / trial / admin / beta = illimité. Seuls les comptes NON archivés comptent.
const STARTER_ACCOUNT_LIMIT = 3;
const FREE_ACCOUNT_LIMIT = 1;

const RULE_DISCLAIMER =
  "Estimation basée uniquement sur les trades loggés dans MyTradingCoach — pas " +
  "l'equity temps réel ni le calcul officiel de la prop firm (positions ouvertes, " +
  "fuseau, trailing intraday). Le statut du compte reste piloté par toi.";

export interface AccountRuleMetrics {
  startingBalance: number;
  realizedPnl: number;
  currentBalance: number;
  tradesCount: number;
  objective: { current: number; target: number; pct: number } | null;
  drawdown: {
    type: DrawdownType;
    floor: number;
    margin: number;
    maxDrawdown: number;
    pct: number;
    breached: boolean;
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
    const accounts = await this.prisma.tradingAccount.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
    if (accounts.length === 0) return [];

    // Une seule requête pour tous les trades fermés des comptes, groupés ensuite en mémoire.
    const trades = await this.prisma.trade.findMany({
      where: {
        userId,
        pnl: { not: null },
        accountId: { in: accounts.map((a) => a.id) },
      },
      select: { accountId: true, pnl: true, tradedAt: true },
      orderBy: { tradedAt: 'asc' },
    });
    const byAccount = new Map<string, RuleTrade[]>();
    for (const t of trades) {
      if (!t.accountId) continue;
      const list = byAccount.get(t.accountId);
      if (list) list.push(t);
      else byAccount.set(t.accountId, [t]);
    }

    return accounts.map((a) => ({
      ...a,
      metrics: this.computeRuleMetrics(a, byAccount.get(a.id) ?? []),
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
   * PASSED/FAILED positionné ici (piloté par l'user) — on se contente d'estimer.
   */
  computeRuleMetrics(
    account: Pick<
      TradingAccount,
      'accountSize' | 'startingBalance' | 'profitTarget' | 'maxDrawdown' | 'drawdownType'
    >,
    trades: RuleTrade[],
  ): AccountRuleMetrics {
    const startingBalance = account.startingBalance ?? account.accountSize ?? 0;
    const sorted = [...trades].sort(
      (a, b) => a.tradedAt.getTime() - b.tradedAt.getTime(),
    );
    const realizedPnl = sorted.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const currentBalance = startingBalance + realizedPnl;

    const objective =
      account.profitTarget != null && account.profitTarget > 0
        ? {
            current: realizedPnl,
            target: account.profitTarget,
            pct: this.clamp01(realizedPnl / account.profitTarget),
          }
        : null;

    let drawdown: AccountRuleMetrics['drawdown'] = null;
    if (account.maxDrawdown != null && account.maxDrawdown > 0) {
      let floor: number;
      if (account.drawdownType === DrawdownType.TRAILING) {
        // Plancher glissant : suit le plus haut solde cumulé atteint (hwm).
        let bal = startingBalance;
        let hwm = startingBalance;
        for (const t of sorted) {
          bal += t.pnl ?? 0;
          if (bal > hwm) hwm = bal;
        }
        floor = hwm - account.maxDrawdown;
      } else {
        // STATIC : plancher fixe depuis le solde de départ.
        floor = startingBalance - account.maxDrawdown;
      }
      const margin = currentBalance - floor;
      drawdown = {
        type: account.drawdownType,
        floor,
        margin,
        maxDrawdown: account.maxDrawdown,
        pct: this.clamp01(margin / account.maxDrawdown),
        breached: margin <= 0,
      };
    }

    return {
      startingBalance,
      realizedPnl,
      currentBalance,
      tradesCount: sorted.length,
      objective,
      drawdown,
      estimated: true,
      disclaimer: RULE_DISCLAIMER,
    };
  }

  /**
   * Quota de comptes du plan : `null` = illimité.
   * Premium / trial / admin / beta → illimité · Starter → 3 · Free → 1.
   * Sans contexte (appels internes) → non plafonné.
   */
  private resolveAccountLimit(ctx?: PlanContext): number | null {
    if (!ctx) return null;
    const { plan, role, trialEndsAt } = ctx;
    if (role === Role.ADMIN || role === Role.BETA_TESTER) return null;
    const inTrial = !!(trialEndsAt && new Date() < new Date(trialEndsAt));
    if (plan === Plan.PREMIUM || inTrial) return null;
    if (plan === Plan.STARTER) return STARTER_ACCOUNT_LIMIT;
    return FREE_ACCOUNT_LIMIT;
  }

  async create(
    userId: string,
    dto: CreateAccountDto,
    ctx?: PlanContext,
  ): Promise<TradingAccount> {
    const limit = this.resolveAccountLimit(ctx);
    if (limit !== null) {
      // Seuls les comptes non archivés consomment le quota (archiver libère un slot).
      const activeCount = await this.prisma.tradingAccount.count({
        where: { userId, status: { not: AccountStatus.ARCHIVED } },
      });
      if (activeCount >= limit) {
        throw new ForbiddenException({
          code: 'ACCOUNT_LIMIT_REACHED',
          limit,
          message: `Limite de ${limit} compte(s) atteinte pour ton plan. Passe à un plan supérieur pour en ajouter.`,
        });
      }
    }
    return this.prisma.tradingAccount.create({ data: { userId, ...dto } });
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateAccountDto,
  ): Promise<TradingAccount> {
    await this.assertOwner(userId, id);
    return this.prisma.tradingAccount.update({ where: { id }, data: dto });
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
   * (Les comptes démo sont read-only — bloqués en amont par DemoReadOnlyGuard.)
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

    const created = await this.prisma.tradingAccount.create({
      data: { userId, label: 'Compte principal' },
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
