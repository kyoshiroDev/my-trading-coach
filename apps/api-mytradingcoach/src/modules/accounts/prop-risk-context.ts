import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import { formatMoney } from '@mtc/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsService, type AccountRuleMetrics } from './accounts.service';
import { tradingDay } from './account-rules';

/**
 * Bloc « prop firm » des prompts IA PREMIUM (#374) : récap 17h30 et Weekly Debrief.
 *
 * Que des FAITS déjà calculés par le back (métriques des comptes, séances vues en direct,
 * alertes et tilt envoyés, #373) : l'IA commente, elle ne calcule jamais une règle. Chaque
 * chiffre est présenté comme une estimation MyTradingCoach, pas le calcul officiel de la firm.
 */

export interface RiskContextAccount {
  id: string;
  label: string;
  currency: string;
  metrics: Pick<AccountRuleMetrics, 'drawdown' | 'dailyLoss' | 'progress'>;
}

export interface RiskContextDay {
  accountId: string;
  /** `AAAA-MM-JJ` */
  day: string;
  minDrawdownMargin: number | null;
  minDrawdownAt: Date | null;
  minDailyLossRemaining: number | null;
  minDailyLossAt: Date | null;
  floorStart: number | null;
  floorEnd: number | null;
}

export interface RiskContextEvent {
  accountId: string;
  day: string;
  kind: string;
  level: string;
  at: Date;
}

const KIND_LABEL: Record<string, string> = {
  drawdown: 'drawdown', daily_loss: 'perte journalière', consistency: 'consistency',
  objective: 'objectif', payout: 'payout',
};
const LEVEL_LABEL: Record<string, string> = {
  warning: 'avertissement', critical: 'critique', breached: 'dépassé', reached: 'atteint',
};
const RULE_LABEL: Record<string, string> = {
  static: 'statique', trailing_eod: 'trailing fin de journée', trailing_intraday: 'trailing intraday',
};
const TILT_LABEL: Record<string, string> = {
  revenge: 'reprise rapide après une perte', size: 'taille grossie après une perte', overtrading: 'surtrading',
};

const time = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const longDay = (day: string) =>
  new Date(`${day}T12:00:00.000Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00.000Z`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });

function eventsLine(events: RiskContextEvent[]): string[] {
  const lines: string[] = [];
  const alerts = events.filter((e) => e.kind !== 'tilt');
  const tilt = events.filter((e) => e.kind === 'tilt');
  if (alerts.length) {
    lines.push(`alertes : ${alerts.map((e) => `${KIND_LABEL[e.kind] ?? e.kind} ${LEVEL_LABEL[e.level] ?? e.level} (${time(e.at)})`).join(', ')}`);
  }
  if (tilt.length) {
    lines.push(`tilt : ${tilt.map((e) => `${TILT_LABEL[e.level] ?? e.level} (${time(e.at)})`).join(', ')}`);
  }
  return lines;
}

function sessionLines(money: (v: number) => string, d: RiskContextDay | undefined, events: RiskContextEvent[]): string[] {
  const parts: string[] = [];
  if (d?.minDrawdownMargin != null) {
    parts.push(`marge drawdown la plus basse ${money(d.minDrawdownMargin)}${d.minDrawdownAt ? ` à ${time(d.minDrawdownAt)}` : ''}`);
  }
  if (d?.minDailyLossRemaining != null) {
    parts.push(`perte journalière encore permise au plus bas ${money(d.minDailyLossRemaining)}${d.minDailyLossAt ? ` à ${time(d.minDailyLossAt)}` : ''}`);
  }
  if (d?.floorStart != null && d.floorEnd != null && d.floorStart !== d.floorEnd) {
    parts.push(`plancher ${money(d.floorStart)} → ${money(d.floorEnd)}`);
  }
  return [...parts, ...eventsLine(events)];
}

/** État actuel du compte, d'après ses métriques (estimations du back). */
function stateLines(a: RiskContextAccount, money: (v: number) => string, withToday: boolean, breachedSince?: string): string[] {
  const m = a.metrics;
  const lines: string[] = [];
  const rule = m.drawdown?.rule;
  if (m.drawdown) {
    // Casse d'un jour précédent : datée, sinon l'IA la lisait comme celle du jour.
    lines.push(m.drawdown.breached
      ? `drawdown : plancher ${money(m.drawdown.floor)} dépassé${breachedSince ? ` depuis le ${longDay(breachedSince)} (pas aujourd'hui)` : ''}`
      : `marge drawdown actuelle ${money(m.drawdown.margin)} sur ${money(m.drawdown.maxDrawdown)} (plancher ${money(m.drawdown.floor)}${rule ? `, ${RULE_LABEL[rule.kind] ?? rule.kind}${rule.locked ? ', figé' : ''}` : ''})`);
  }
  if (withToday && m.dailyLoss) {
    lines.push(`perte journalière : ${money(m.dailyLoss.used)} perdus sur ${money(m.dailyLoss.limit)} autorisés${m.dailyLoss.breached ? ' (limite atteinte)' : ''}`);
  }
  const p = m.progress;
  if (p) {
    const what = p.kind === 'objective' ? 'objectif' : 'prochain payout';
    lines.push(p.done ? `${what} : toutes les conditions du plan remplies` : `${what} : il manque ${money(p.remaining)}`);
    const cons = p.requirements.find((r) => r.key === 'consistency');
    if (cons) {
      const cap = withToday && cons.dayCap != null ? `, gain max aujourd'hui ${money(Math.max(0, cons.dayCap - (cons.todayPnl ?? 0)))}` : '';
      lines.push(`consistency : meilleur jour = ${Math.round(cons.current * 100)} % du profit (limite ${Math.round(cons.required * 100)} %)${cap}`);
    }
  }
  return lines;
}

/**
 * Bloc texte, ou null si aucun compte n'a de règle prop firm ni de séance suivie.
 * `scope` : `day` (récap du jour : état + séance du jour) ou `week` (débrief : état + une ligne
 * par journée de la semaine).
 */
export function buildPropRiskContext(
  accounts: RiskContextAccount[],
  days: RiskContextDay[],
  events: RiskContextEvent[],
  scope: 'day' | 'week',
  /** Compte → jour (`AAAA-MM-JJ`) de la casse du drawdown, quand elle précède la période. */
  breachedSince: Record<string, string> = {},
): string | null {
  const blocks: string[] = [];
  for (const a of accounts) {
    const money = (v: number) => formatMoney(v, a.currency, { decimals: 0, sign: false });
    const accDays = days.filter((d) => d.accountId === a.id).sort((x, y) => x.day.localeCompare(y.day));
    const accEvents = events.filter((e) => e.accountId === a.id).sort((x, y) => x.at.getTime() - y.at.getTime());
    const state = stateLines(a, money, scope === 'day', breachedSince[a.id]);
    let session: string[] = [];
    if (scope === 'day') {
      session = sessionLines(money, accDays[accDays.length - 1], accEvents);
    } else {
      const dayKeys = [...new Set([...accDays.map((d) => d.day), ...accEvents.map((e) => e.day)])].sort();
      session = dayKeys
        .map((k) => {
          const parts = sessionLines(money, accDays.find((d) => d.day === k), accEvents.filter((e) => e.day === k));
          return parts.length ? `${dayLabel(k)} : ${parts.join(' ; ')}` : '';
        })
        .filter(Boolean);
    }
    if (!state.length && !session.length) continue;
    const plan = a.metrics.drawdown?.rule ? ` (${a.metrics.drawdown.rule.firmName} · ${a.metrics.drawdown.rule.planName})` : '';
    blocks.push([
      `- « ${a.label} »${plan}, devise ${a.currency} :`,
      ...state.map((l) => `    · ${l}`),
      ...(session.length ? [scope === 'day' ? '    · séance suivie en direct :' : '    · séances suivies en direct :', ...session.map((l) => `        ${l}`)] : []),
    ].join('\n'));
  }
  return blocks.length ? blocks.join('\n') : null;
}

/** Charge les données et construit le bloc (comptes actifs du user, Premium). */
@Injectable()
export class PropRiskContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
  ) {}

  /**
   * Journée de trading de `date` (récap du jour). `tradedAccountIds` : seuls ces comptes, avec ou
   * sans règle prop firm dès qu'ils ont une alerte ou un tilt ce jour-là (sinon, un compte cassé
   * deux jours plus tôt, non tradé, passait pour la casse du jour et le tilt du compte tradé
   * disparaissait : récap de Val, 2026-10-09).
   */
  forDay(userId: string, date: Date, tradedAccountIds?: string[]): Promise<string | null> {
    const day = tradingDay(date);
    return this.load(userId, day, day, 'day', tradedAccountIds);
  }

  /** Semaine du débrief, bornes incluses. */
  forWeek(userId: string, start: Date, end: Date): Promise<string | null> {
    return this.load(userId, start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), 'week');
  }

  private async load(
    userId: string, from: string, to: string, scope: 'day' | 'week', onlyAccountIds?: string[],
  ): Promise<string | null> {
    const hasRules = (a: RiskContextAccount) => !!(a.metrics.drawdown || a.metrics.progress || a.metrics.dailyLoss);
    const all = await this.accounts.list(userId, { premium: true });
    const candidates = onlyAccountIds
      ? all.filter((a) => onlyAccountIds.includes(a.id))
      : all.filter((a) => a.status === AccountStatus.ACTIVE && hasRules(a));
    if (!candidates.length) return null;
    const ids = candidates.map((a) => a.id);
    const start = new Date(`${from}T00:00:00.000Z`);
    const range = { gte: start, lte: new Date(`${to}T00:00:00.000Z`) };
    const [rawDays, rawEvents, breaches] = await Promise.all([
      this.prisma.accountRiskDay.findMany({ where: { accountId: { in: ids }, tradeDate: range } }),
      this.prisma.propRiskEvent.findMany({ where: { userId, accountId: { in: ids }, tradeDate: range }, orderBy: { createdAt: 'asc' } }),
      this.prisma.propRiskEvent.findMany({
        where: { userId, accountId: { in: ids }, kind: 'drawdown', level: 'breached', tradeDate: { lt: start } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const days = rawDays.map((d) => ({ ...d, day: d.tradeDate.toISOString().slice(0, 10) }));
    const events = rawEvents.map((e) => ({
      accountId: e.accountId, day: e.tradeDate.toISOString().slice(0, 10), kind: e.kind, level: e.level, at: e.createdAt,
    }));
    const breachedSince: Record<string, string> = {};
    const breachedInRange = (id: string) => events.some((e) => e.accountId === id && e.kind === 'drawdown' && e.level === 'breached');
    for (const b of breaches) {
      if (!breachedInRange(b.accountId)) breachedSince[b.accountId] ??= b.tradeDate.toISOString().slice(0, 10);
    }
    // Compte tradé sans règle prop firm : gardé seulement s'il s'est passé quelque chose (alerte, tilt).
    const accounts = onlyAccountIds
      ? candidates.filter((a) => hasRules(a) || events.some((e) => e.accountId === a.id))
      : candidates;
    return buildPropRiskContext(accounts, days, events, scope, breachedSince);
  }
}
