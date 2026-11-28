import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import {
  SESSION_CONTRACT_BOUNDS,
  SESSION_CONTRACT_RULES,
  evaluateContract,
  type PropFirmPhaseRules,
  type SessionContract,
  type SessionContractDefaults,
  type SessionContractEdit,
  type SessionContractEvaluation,
  type SessionContractRules,
} from '@mtc/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountsService } from '../../accounts/accounts.service';
import { dailyLossLimitAt, phaseForAccountType } from '../../behavior/behavior-plan';
import { highImpactEventsBetween } from '../../behavior/high-impact-events';
import { newsShieldMinutes } from '../../behavior/behavior-news';
import { tradingDayStart } from '../active-session';
import type { SessionContractDto } from '../dto/session-contract.dto';
import { sessionContractEnabled } from './session-contract.flag';
import { EMPTY, editsBetween, mergeRules, normalizeAssets, rulesOf, toView } from './session-contract.view';

export { editsBetween, mergeRules, normalizeAssets, toView } from './session-contract.view';

/**
 * Contrat de session (#667) : préremplissage, enregistrement au démarrage, modification tracée pendant la
 * séance, évaluation à la lecture (rien de stocké). Gratuit (décision provisoire du 2026-11-28).
 */
@Injectable()
export class SessionContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Préremplissage : contrat de la dernière séance du compte, sinon le profil (trades max, minutes du
   * bouclier, actifs). Signale une perte max perso plus large que la limite de la firm (phase du plan).
   */
  async defaults(userId: string, accountId?: string, now = new Date()): Promise<SessionContractDefaults> {
    const resolved = accountId && accountId !== 'all'
      ? (await this.accounts.accountWhere(userId, accountId)).accountId
      : await this.accounts.ensureDefaultAccountId(userId);
    if (!resolved) throw new NotFoundException('Compte introuvable');

    const [last, user, firmDailyLossLimit] = await Promise.all([
      this.prisma.sessionContract.findFirst({
        where: { userId, session: { accountId: resolved } },
        orderBy: { createdAt: 'desc' },
        include: { session: { select: { startedAt: true } } },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { tradesPerDayMax: true, newsShieldMinutes: true, tradingAssets: true } }),
      this.firmDailyLossLimit(userId, resolved, now),
    ]);

    let rules: SessionContractRules;
    let source: SessionContractDefaults['source'];
    if (last) {
      rules = rulesOf(last);
      source = 'last_session';
    } else {
      const shield = newsShieldMinutes(user?.newsShieldMinutes);
      rules = {
        ...EMPTY,
        maxTrades: user?.tradesPerDayMax && user.tradesPerDayMax > 0 ? Math.min(user.tradesPerDayMax, SESSION_CONTRACT_BOUNDS.maxTrades.max) : null,
        newsMinutes: shield > 0 ? shield : null,
        allowedAssets: normalizeAssets(user?.tradingAssets ?? []).slice(0, SESSION_CONTRACT_BOUNDS.allowedAssets.maxItems),
      };
      source = SESSION_CONTRACT_RULES.some((f) => (f === 'allowedAssets' ? rules.allowedAssets.length : rules[f] != null)) ? 'profile' : 'none';
    }
    return {
      accountId: resolved,
      rules,
      source,
      lastSessionAt: last?.session.startedAt.toISOString() ?? null,
      firmDailyLossLimit,
      looserThanFirm: firmDailyLossLimit != null && rules.maxDailyLoss != null && rules.maxDailyLoss > firmDailyLossLimit,
    };
  }

  /** Limite de perte du jour de la firm (phase du plan relié), estimation ; null sans règle. */
  private async firmDailyLossLimit(userId: string, accountId: string, now: Date): Promise<number | null> {
    const account = await this.prisma.tradingAccount.findFirst({
      where: { id: accountId, userId },
      select: { type: true, propFirmPlan: { select: { phases: true } } },
    });
    const phases = (account?.propFirmPlan?.phases ?? []) as unknown as PropFirmPhaseRules[];
    const phase = phaseForAccountType(phases, account?.type);
    if (!phase?.daily_loss_limit) return null;
    // Palier selon le profit réalisé avant la journée en cours (net de frais).
    const agg = await this.prisma.trade.aggregate({
      where: { userId, accountId, pnl: { not: null }, tradedAt: { lt: tradingDayStart(now) } },
      _sum: { pnl: true, commission: true },
    });
    const profit = (agg._sum.pnl ?? 0) - Math.abs(agg._sum.commission ?? 0);
    return dailyLossLimitAt(phase, profit);
  }

  /** Contrat enregistré avec la séance (démarrage). Rien si l'interrupteur est éteint ou sans règle. */
  async createForSession(userId: string, sessionId: string, dto: SessionContractDto | undefined): Promise<void> {
    if (!sessionContractEnabled() || !dto) return;
    const rules = mergeRules(EMPTY, dto);
    await this.prisma.sessionContract.create({ data: { sessionId, userId, ...rules, edits: [] } });
  }

  /**
   * Modification pendant la séance (ACTIVE, à l'utilisateur) : upsert, chaque changement tracé. Une séance
   * lancée sans contrat peut en recevoir un : la trace part de « non fixé », les trades d'avant ne sont pas jugés.
   */
  async update(userId: string, sessionId: string, dto: SessionContractDto, now = new Date()): Promise<SessionContract> {
    const session = await this.prisma.tradeSession.findFirst({
      where: { id: sessionId, userId },
      select: { status: true, contract: true },
    });
    if (!session) throw new NotFoundException('Session introuvable');
    if (session.status !== SessionStatus.ACTIVE) throw new BadRequestException('Séance clôturée : contrat non modifiable.');

    const before = session.contract ? rulesOf(session.contract) : EMPTY;
    const after = mergeRules(before, dto);
    const prev = (session.contract?.edits as unknown as SessionContractEdit[] | undefined) ?? [];
    const edits = [...prev, ...editsBetween(before, after, now)];
    if (edits.length > SESSION_CONTRACT_BOUNDS.edits.maxItems) {
      throw new BadRequestException(`${SESSION_CONTRACT_BOUNDS.edits.maxItems} modifications au plus par séance.`);
    }
    const data = { ...after, edits: edits as unknown as Prisma.InputJsonValue };
    const row = await this.prisma.sessionContract.upsert({
      where: { sessionId },
      create: { sessionId, userId, ...data },
      update: data,
    });
    return toView(row);
  }

  /**
   * Contrat et évaluation d'une séance, calculée à la lecture. `null` sans contrat ou interrupteur éteint.
   * Trades : ceux de la séance (même compte, #457) ; annonces chargées seulement si la règle a été fixée.
   */
  async forSession(
    userId: string,
    session: { id: string; accountId: string | null; startedAt: Date; endedAt: Date | null },
    now = new Date(),
  ): Promise<{ contract: SessionContract; evaluation: SessionContractEvaluation } | null> {
    if (!sessionContractEnabled()) return null;
    const row = await this.prisma.sessionContract.findUnique({ where: { sessionId: session.id } });
    if (!row || row.userId !== userId) return null;
    const contract = toView(row);
    const trades = await this.prisma.trade.findMany({
      where: { userId, sessionId: session.id, ...(session.accountId ? { accountId: session.accountId } : {}) },
      select: { id: true, asset: true, tradedAt: true, pnl: true, commission: true },
      orderBy: { tradedAt: 'asc' },
    });
    const newsRule = row.newsMinutes != null || contract.edits.some((e) => e.field === 'newsMinutes');
    const events = newsRule ? await highImpactEventsBetween(this.prisma, session.startedAt, session.endedAt ?? now) : undefined;
    return { contract, evaluation: evaluateContract(contract, trades, events) };
  }
}
