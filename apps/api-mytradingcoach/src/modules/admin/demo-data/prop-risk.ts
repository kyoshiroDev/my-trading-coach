// Journal de risque des séances du compte démo connecté (#373) : relevés et alertes que le suivi
// en direct aurait enregistrés, tirés des trades seedés avec les VRAIES règles du back.
import { formatMoney } from '@mtc/shared';
import { tradingDay } from '../../accounts/account-rules';
import { alertLevel, type PropAlertLevel } from '../../integrations/tradovate/prop-alerts.service';
import { detectTilt, type TiltTrade } from '../../integrations/tradovate/tilt-detection';
import { round2 } from './config';
import { type DemoTrade, net } from './model';

/** Règles du plan `apex-eod-50k` (catalogue) : trailing EOD jamais figé sur Tradovate. */
export interface DemoRiskRules {
  startingBalance: number;
  maxDrawdown: number;
  dailyLossLimit: number;
}

export interface DemoRiskDay {
  day: string;
  minDrawdownMargin: number;
  minDrawdownAt: Date;
  minDailyLossRemaining: number;
  minDailyLossAt: Date;
  floorStart: number;
  floorEnd: number;
}

export interface DemoRiskEvent {
  day: string;
  kind: 'drawdown' | 'daily_loss' | 'tilt';
  level: string;
  data: Record<string, number | null>;
  at: Date;
}

const RANK: Record<PropAlertLevel, number> = { warning: 1, critical: 2, breached: 3, reached: 4 };

/**
 * Rejoue les séances du compte, trade par trade (solde réalisé, pas de latent seedé) :
 * plancher trailing EOD = plus haute clôture - drawdown max, perte journalière comptée depuis la
 * clôture de la veille. Alertes : une par niveau franchi, comme `PropAlertsService` ; tilt :
 * `detectTilt` à chaque trade, comme `TiltAlertsService`.
 */
export function buildDemoRiskJournal(trades: DemoTrade[], rules: DemoRiskRules): { days: DemoRiskDay[]; events: DemoRiskEvent[] } {
  const sorted = [...trades].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const bySession = new Map<string, DemoTrade[]>();
  for (const t of sorted) {
    const k = tradingDay(t.tradedAt);
    bySession.set(k, [...(bySession.get(k) ?? []), t]);
  }

  const days: DemoRiskDay[] = [];
  const events: DemoRiskEvent[] = [];
  const pastQuantities: number[] = [];
  const pastCounts: number[] = [];
  let close = rules.startingBalance;
  let peakClose = rules.startingBalance;
  for (const [day, session] of bySession) {
    const floor = round2(peakClose - rules.maxDrawdown);
    let balance = close;
    let row: DemoRiskDay | null = null;
    const sent = new Map<string, PropAlertLevel>();
    const today: TiltTrade[] = [];
    for (const t of session) {
      balance += net(t);
      const margin = round2(balance - floor);
      const remaining = round2(rules.dailyLossLimit - Math.max(0, close - balance));
      if (!row) {
        row = { day, minDrawdownMargin: margin, minDrawdownAt: t.tradedAt, minDailyLossRemaining: remaining, minDailyLossAt: t.tradedAt, floorStart: floor, floorEnd: floor };
      }
      if (margin < row.minDrawdownMargin) Object.assign(row, { minDrawdownMargin: margin, minDrawdownAt: t.tradedAt });
      if (remaining < row.minDailyLossRemaining) Object.assign(row, { minDailyLossRemaining: remaining, minDailyLossAt: t.tradedAt });

      for (const [kind, left, limit] of [['drawdown', margin, rules.maxDrawdown], ['daily_loss', remaining, rules.dailyLossLimit]] as const) {
        const level = alertLevel(left / limit, left <= 0);
        const prev = sent.get(kind);
        if (!level || (prev && RANK[prev] >= RANK[level])) continue;
        sent.set(kind, level);
        events.push({ day, kind, level, data: { remaining: Math.max(0, left), limit, breach: null }, at: t.tradedAt });
      }

      today.push({ id: `${day}-${today.length}`, pnl: t.pnl, quantity: t.quantity, tradedAt: t.tradedAt });
      for (const { signal, ref: _ref, ...details } of detectTilt(today, { quantities: pastQuantities, dailyCounts: pastCounts }, day)) {
        // Surtrading : une fois par journée, comme la clé Redis du service.
        if (signal === 'overtrading' && events.some((e) => e.day === day && e.level === 'overtrading')) continue;
        events.push({ day, kind: 'tilt', level: signal, data: details as Record<string, number>, at: t.tradedAt });
      }
    }
    if (row) days.push(row);
    pastQuantities.push(...session.map((t) => t.quantity));
    pastCounts.push(session.length);
    close = balance;
    peakClose = Math.max(peakClose, close);
  }
  return { days, events };
}

const TILT_TEXT: Record<string, string> = {
  revenge: 'reprise moins de 2 minutes après une perte',
  size: 'taille grossie après une perte',
  overtrading: 'journée surchargée',
};
const KIND_TEXT: Record<string, string> = { drawdown: 'drawdown', daily_loss: 'perte journalière' };
const LEVEL_TEXT: Record<string, string> = { warning: 'avertissement', critical: 'critique', breached: 'dépassé' };
const time = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const money = (v: number) => formatMoney(v, 'USD', { decimals: 0, sign: false });

/**
 * Lecture « IA Premium » d'une semaine de séances suivies en direct (#374), telle que le débrief
 * l'écrirait à partir du bloc prop firm : faits du back commentés, jamais recalculés.
 */
export function weekRiskNote(days: DemoRiskDay[], events: DemoRiskEvent[]): string | null {
  if (!days.length) return null;
  const low = days.reduce((a, b) => (b.minDrawdownMargin < a.minDrawdownMargin ? b : a));
  const alerts = events.filter((e) => e.kind !== 'tilt');
  const tilt = events.filter((e) => e.kind === 'tilt');
  const parts = [`Séances suivies en direct : marge de drawdown la plus basse ${money(low.minDrawdownMargin)} (${time(low.minDrawdownAt)}).`];
  if (alerts.length) {
    parts.push(`Alertes reçues : ${alerts.map((e) => `${KIND_TEXT[e.kind]} ${LEVEL_TEXT[e.level] ?? e.level} à ${time(e.at)}`).join(', ')}.`);
  }
  if (tilt.length) {
    parts.push(`Anti-tilt : ${[...new Set(tilt.map((e) => TILT_TEXT[e.level] ?? e.level))].join(', ')}. Règle à tenir : 15 minutes de pause après une perte.`);
  } else if (!alerts.length) {
    parts.push('Aucune alerte ni signal de tilt : la marge n\'a jamais été menacée.');
  }
  return parts.join(' ');
}

/** Récap 17h30 d'une journée avec alerte ou tilt : il parle d'abord de la limite approchée. */
export function dayRiskLine(day: DemoRiskDay | undefined, events: DemoRiskEvent[]): string | null {
  const tilt = events.find((e) => e.kind === 'tilt');
  if (!day || !events.length) return null;
  const head = tilt
    ? `Anti-tilt à ${time(tilt.at)} (${TILT_TEXT[tilt.level] ?? tilt.level})`
    : `Alerte ${KIND_TEXT[events[0].kind]} à ${time(events[0].at)}`;
  return `${head} : ta marge de drawdown est descendue à ${money(day.minDrawdownMargin)} (estimé). Une pause après chaque perte, pas une ré-entrée.`;
}
