import { formatMoney, netPnl } from '@mtc/shared';

/**
 * Autopsie d'un compte grillé (#669) — fonctions PURES (sans Nest ni base), testées seules.
 *
 * Que des faits : les trades de la séance, les alertes enregistrées, la taille, la distance à la
 * limite et 3 constats chiffrés. Aucun conseil, aucune prédiction. L'heure d'entrée n'est pas en
 * base (`tradedAt` = première sortie) : la distance est reconstruite trade par trade sur le
 * réalisé, à partir de la marge relevée à la détection. C'est une estimation, affichée comme telle.
 */

export type IncidentKind = 'drawdown' | 'daily_loss' | 'manual';

/** Chiffres relevés à la détection (`AccountIncident.data`). */
export interface IncidentSnapshot {
  /** Drawdown max ou perte du jour autorisée. */
  limit: number | null;
  /** Marge restante (≤ 0 : limite franchie). */
  remaining: number | null;
  /** ISO : moment du relevé. */
  detectedAt: string;
}

export interface IncidentTrade {
  id: string;
  tradedAt: Date;
  asset: string;
  side: string;
  quantity: number | null;
  pnl: number | null;
  commission: number | null;
}

/** Alerte enregistrée par MTC pendant la séance : anti-tilt (`BehaviorAlert`) ou prop firm (`PropRiskEvent`). */
export interface IncidentAlert {
  at: Date;
  source: 'behavior' | 'prop';
  /** `BehaviorAlert.type`, ou `PropRiskEvent.kind`. */
  type: string;
  /** `PropRiskEvent.level` (absent pour l'anti-tilt). */
  level?: string;
}

/** Une séance précédente du compte, pour situer celle de l'incident. */
export interface PreviousSession {
  day: string;
  trades: number;
  maxQuantity: number | null;
  net: number;
}

export type TimelineEntry =
  | {
      type: 'trade';
      at: string;
      tradeId: string;
      asset: string;
      side: string;
      quantity: number | null;
      net: number;
      /** Marge estimée après ce trade, null sans relevé. */
      distanceAfter: number | null;
      /** Trade daté après une alerte de la séance. */
      afterAlert: boolean;
    }
  | {
      type: 'alert';
      at: string;
      label: string;
      /** Minutes jusqu'au trade suivant, null s'il n'y en a pas. */
      nextTradeMinutes: number | null;
    };

export interface IncidentReport {
  kpis: {
    net: number;
    trades: number;
    maxQuantity: number | null;
    firstQuantity: number | null;
    /** Marge estimée avant le premier trade de la séance. */
    startDistance: number | null;
  };
  /** Distance à la limite : départ puis un point par trade. */
  series: { at: string | null; distance: number }[];
  timeline: TimelineEntry[];
  findings: string[];
}

export interface IncidentReportInput {
  kind: IncidentKind;
  currency: string;
  snapshot: IncidentSnapshot | null;
  /** Trades de la séance, dans n'importe quel ordre. */
  trades: IncidentTrade[];
  alerts: IncidentAlert[];
  previous: PreviousSession[];
}

const BEHAVIOR_LABEL: Record<string, string> = {
  A1_SIZE_OVER_PLAN: 'taille au-dessus du maximum du plan',
  A2_DAILY_LOSS_DISTANCE: 'perte max du jour à portée',
  A3_ENTRY_DAY_STARTED: 'entrée avec la perte du jour entamée',
  B_REVENGE: 'reprise rapide après une perte',
  C1_LOSS_STREAK: "pertes d'affilée",
  C2_OVER_DAILY_LIMIT: 'nombre de trades du jour dépassé',
  C3_MARTINGALE: 'taille grossie après une perte',
};
const PROP_KIND_LABEL: Record<string, string> = { drawdown: 'marge drawdown', daily_loss: 'perte du jour' };
const PROP_LEVEL_LABEL: Record<string, string> = { warning: 'sous 25 %', critical: 'sous 10 %' };
const TILT_LABEL: Record<string, string> = {
  revenge: 'reprise rapide après une perte', size: 'taille grossie après une perte', overtrading: 'surtrading',
};

/** Libellé d'une alerte, null si elle ne compte pas (franchissement lui-même, bonnes nouvelles…). */
export function alertLabel(a: IncidentAlert): string | null {
  if (a.source === 'behavior') return BEHAVIOR_LABEL[a.type] ?? null;
  if (a.type === 'tilt') return a.level && TILT_LABEL[a.level] ? TILT_LABEL[a.level] : null;
  const kind = PROP_KIND_LABEL[a.type];
  const level = a.level ? PROP_LEVEL_LABEL[a.level] : undefined;
  return kind && level ? `${kind} ${level}` : null;
}

const time = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2));
const contracts = (q: number) => `${qty(q)} contrat${q > 1 ? 's' : ''}`;
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Séances précédentes minimum pour comparer la séance à l'habitude du compte. */
export const MIN_PREVIOUS_SESSIONS = 5;

interface Finding {
  weight: number;
  text: string;
}

/**
 * Point où la distance passe d'au-dessus de la limite à zéro ou dessous, null si elle ne la
 * franchit pas pendant la séance (jamais atteinte, ou déjà franchie avant le premier trade).
 */
export function crossingPoint(series: IncidentReport['series']): IncidentReport['series'][number] | null {
  for (let i = 1; i < series.length; i++) {
    if (series[i].at && series[i - 1].distance > 0 && series[i].distance <= 0) return series[i];
  }
  return null;
}

export function buildIncidentReport(input: IncidentReportInput): IncidentReport {
  const money = (v: number) => formatMoney(v, input.currency, { decimals: 0 });
  const amount = (v: number) => formatMoney(Math.abs(v), input.currency, { decimals: 0, sign: false });
  /** Marge : signe seulement sous zéro (`$2,000`, `-$98`), jamais perdu. */
  const margin = (v: number) => formatMoney(v, input.currency, { decimals: 0, sign: false });
  const trades = [...input.trades]
    .sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime())
    .map((t) => ({ ...t, net: netPnl(t) ?? 0 }));
  const alerts = input.alerts
    .map((a) => ({ ...a, label: alertLabel(a) }))
    .filter((a): a is typeof a & { label: string } => a.label !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  // Marge avant le premier trade = marge relevée − réalisé jusqu'au relevé ; les trades sortis
  // après (position encore ouverte au franchissement) s'ajoutent ensuite.
  const snap = input.snapshot;
  let startDistance: number | null = null;
  if (snap?.remaining != null) {
    const detectedAt = new Date(snap.detectedAt).getTime();
    const realizedBefore = trades.filter((t) => t.tradedAt.getTime() <= detectedAt).reduce((s, t) => s + t.net, 0);
    startDistance = snap.remaining - realizedBefore;
  }

  const firstAlertAt = alerts[0]?.at.getTime() ?? null;
  const series: IncidentReport['series'] = startDistance != null ? [{ at: null, distance: startDistance }] : [];
  let distance = startDistance;
  const tradeEntries: (TimelineEntry & { type: 'trade' })[] = trades.map((t) => {
    if (distance != null) {
      distance += t.net;
      series.push({ at: t.tradedAt.toISOString(), distance });
    }
    return {
      type: 'trade', at: t.tradedAt.toISOString(), tradeId: t.id, asset: t.asset, side: t.side,
      quantity: t.quantity, net: t.net, distanceAfter: distance,
      afterAlert: firstAlertAt != null && t.tradedAt.getTime() > firstAlertAt,
    };
  });
  const alertEntries: TimelineEntry[] = alerts.map((a) => {
    const next = trades.find((t) => t.tradedAt.getTime() > a.at.getTime());
    return {
      type: 'alert', at: a.at.toISOString(), label: a.label,
      nextTradeMinutes: next ? Math.round((next.tradedAt.getTime() - a.at.getTime()) / 60_000) : null,
    };
  });
  // À heure égale, l'alerte passe avant le trade : elle l'a précédé.
  const timeline = [...tradeEntries, ...alertEntries].sort(
    (a, b) => a.at.localeCompare(b.at) || (a.type === 'alert' ? -1 : 1) - (b.type === 'alert' ? -1 : 1),
  );

  const net = trades.reduce((s, t) => s + t.net, 0);
  const sizes = trades.map((t) => t.quantity).filter((q): q is number => q != null && q > 0);
  const maxQuantity = sizes.length ? Math.max(...sizes) : null;
  const firstQuantity = sizes[0] ?? null;

  const findings: Finding[] = [];

  // Taille qui grossit au fil de la séance (et après combien de pertes d'affilée).
  if (firstQuantity != null && maxQuantity != null && maxQuantity > firstQuantity) {
    const firstMaxIdx = trades.findIndex((t) => t.quantity === maxQuantity);
    let streak = 0;
    for (let i = firstMaxIdx - 1; i >= 0 && trades[i].net < 0; i--) streak++;
    const before = trades.slice(0, firstMaxIdx).length;
    findings.push({
      weight: 3 + maxQuantity / firstQuantity,
      text: `Taille : ${contracts(firstQuantity)} au premier trade, ${contracts(maxQuantity)} à partir du ${before + 1}e`
        + (streak >= 2 ? `, après ${streak} pertes d'affilée.` : '.'),
    });
  }

  // Perte concentrée sur les derniers trades.
  if (net < 0 && trades.length >= 3) {
    for (let k = 1; k < trades.length; k++) {
      const last = trades.slice(-k).reduce((s, t) => s + t.net, 0);
      if (last <= 0.6 * net) {
        findings.push({
          weight: 2 + (1 - k / trades.length) * 2,
          text: `${k === 1 ? 'Le dernier trade représente' : `Les ${k} derniers trades représentent`} ${amount(last)} des ${amount(net)} perdus sur la séance.`,
        });
        break;
      }
    }
  }

  // Trades pris après la première alerte de la séance.
  if (firstAlertAt != null) {
    const after = trades.filter((t) => t.tradedAt.getTime() > firstAlertAt);
    if (after.length) {
      const afterNet = after.reduce((s, t) => s + t.net, 0);
      findings.push({
        weight: 3.5 + after.length / 10,
        text: `${after.length} trade${after.length > 1 ? 's pris' : ' pris'} après l'alerte de ${time(alerts[0].at)} (${alerts[0].label}), pour ${money(afterNet)}.`,
      });
    }
  }

  // Séance comparée aux précédentes du compte (point 8 : les constats peuvent s'en servir).
  if (input.previous.length >= MIN_PREVIOUS_SESSIONS) {
    const n = input.previous.length;
    const medTrades = median(input.previous.map((p) => p.trades));
    if (medTrades != null && trades.length >= Math.max(3, 1.5 * medTrades)) {
      findings.push({
        weight: 2 + trades.length / medTrades / 2,
        text: `${trades.length} trades sur la séance, contre ${qty(medTrades)} en médiane sur tes ${n} séances précédentes de ce compte.`,
      });
    }
    const medSize = median(input.previous.map((p) => p.maxQuantity).filter((q): q is number => q != null && q > 0));
    if (medSize != null && maxQuantity != null && maxQuantity >= 1.5 * medSize) {
      findings.push({
        weight: 2 + maxQuantity / medSize / 2,
        text: `Taille max de ${contracts(maxQuantity)}, contre ${qty(medSize)} en médiane sur tes séances précédentes de ce compte.`,
      });
    }
    const worst = Math.min(...input.previous.map((p) => p.net));
    if (net < 0 && net < worst) {
      findings.push({
        weight: 1.5,
        text: `Séance la plus lourde du compte : ${money(net)}, la pire des ${n} précédentes était à ${money(worst)}.`,
      });
    }
  }

  // Repères toujours disponibles, en dernier recours.
  if (startDistance != null && series.length > 1) {
    const crossed = crossingPoint(series);
    findings.push({
      weight: 1,
      // Déjà sous la limite avant la séance (casse d'un jour précédent, synchro tardive) : on le dit
      // au lieu de dater un franchissement qui n'a pas eu lieu pendant la séance.
      text: startDistance <= 0
        ? `Limite estimée déjà franchie avant la séance : marge estimée de ${margin(startDistance)} avant le premier trade.`
        : `Marge estimée de ${margin(startDistance)} avant le premier trade`
          + (crossed?.at ? `, limite estimée franchie à ${time(new Date(crossed.at))}.` : '.'),
    });
  }
  if (trades.length) {
    findings.push({
      weight: 0.5,
      text: `Séance de ${trades.length} trade${trades.length > 1 ? 's' : ''} entre ${time(trades[0].tradedAt)} et ${time(trades[trades.length - 1].tradedAt)}, pour ${money(net)}.`,
    });
  }

  return {
    kpis: { net, trades: trades.length, maxQuantity, firstQuantity, startDistance },
    series,
    timeline,
    // Ordre stable : poids décroissant, puis ordre d'ajout.
    findings: findings
      .map((f, i) => ({ ...f, i }))
      .sort((a, b) => b.weight - a.weight || a.i - b.i)
      .slice(0, 3)
      .map((f) => f.text),
  };
}
