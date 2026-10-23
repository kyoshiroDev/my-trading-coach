import { formatMoney, type AccountIncidentReport } from '@mtc/shared';

/**
 * Autopsie d'un compte grillé (#669) : mise en forme PURE de la réponse de l'API (maquette
 * `maquettes/mockup-autopsie.html`). Aucun calcul de règle ici, les chiffres viennent du back.
 */

const PARIS = 'Europe/Paris';

/** `HH:MM` à Paris. */
export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: PARIS });
}

/** `14 oct.` à Paris. */
export function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: PARIS });
}

const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2));
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/** Montant signé (`+$80`, `-$1,050`). */
export function signedMoney(v: number, currency: string): string {
  return formatMoney(v, currency, { decimals: 0 });
}

/** Distance à la limite (`$1,080`, `-$50`) : signe seulement sous zéro. */
export function distanceMoney(v: number, currency: string): string {
  return formatMoney(v, currency, { decimals: 0, sign: false });
}

/**
 * Heure à laquelle la distance estimée passe d'au-dessus de la limite à zéro ou dessous, null si
 * elle ne la franchit pas pendant la séance (jamais atteinte, ou déjà franchie avant).
 */
export function crossedAt(r: AccountIncidentReport): string | null {
  const s = r.series;
  for (let i = 1; i < s.length; i++) {
    if (s[i].at && s[i - 1].distance > 0 && s[i].distance <= 0) return s[i].at;
  }
  return null;
}

/** Marge estimée déjà à zéro ou dessous avant le premier trade de la séance. */
export function alreadyCrossed(r: AccountIncidentReport): boolean {
  return r.kpis.startDistance != null && r.kpis.startDistance <= 0;
}

/** Phrase sous le titre (maquette : « Plancher estimé franchi le 14 oct. à 11:12 · séance de 5 trades · … »). */
export function headline(r: AccountIncidentReport): string {
  const day = shortDay(`${r.tradeDate}T12:00:00.000Z`);
  const crossed = crossedAt(r);
  const when = alreadyCrossed(r) ? `avant la séance du ${day}`
    : crossed ? `le ${shortDay(crossed)} à ${clock(crossed)}` : `le ${day}`;
  const what =
    r.kind === 'drawdown' ? `Plancher estimé ${alreadyCrossed(r) ? 'déjà franchi' : 'franchi'} ${when}`
      : r.kind === 'daily_loss' ? `Perte du jour estimée ${alreadyCrossed(r) ? 'déjà atteinte' : 'atteinte'} ${when}`
        : `Compte marqué comme échoué · dernière séance du ${day}`;
  return `${what} · séance de ${plural(r.kpis.trades, 'trade')} · ${r.disclaimer.charAt(0).toLowerCase()}${r.disclaimer.slice(1)}`;
}

export interface AutopsyKpi {
  label: string;
  value: string;
  sub: string;
  tone: 'pos' | 'neg' | null;
}

/** Les 3 cartes du haut : séance, taille max, marge au départ. */
export function autopsyKpis(r: AccountIncidentReport): AutopsyKpi[] {
  const { kpis } = r;
  const firstTrade = r.timeline.find((e) => e.type === 'trade');
  const maxTrade = r.timeline.find((e) => e.type === 'trade' && e.quantity === kpis.maxQuantity);
  const asset = maxTrade?.type === 'trade' ? ` ${maxTrade.asset}` : '';
  return [
    {
      label: 'SÉANCE', value: signedMoney(kpis.net, r.account.currency), sub: plural(kpis.trades, 'trade'),
      tone: kpis.net < 0 ? 'neg' : kpis.net > 0 ? 'pos' : null,
    },
    {
      label: 'TAILLE MAX',
      value: kpis.maxQuantity != null ? `${qty(kpis.maxQuantity)}${asset}` : '-',
      sub: kpis.firstQuantity != null && kpis.maxQuantity != null && kpis.maxQuantity > kpis.firstQuantity
        ? `contre ${qty(kpis.firstQuantity)} au début` : 'taille constante',
      tone: null,
    },
    {
      label: 'MARGE AU DÉPART',
      value: kpis.startDistance != null ? distanceMoney(kpis.startDistance, r.account.currency) : '-',
      sub: kpis.startDistance == null ? 'non relevée' : firstTrade ? `avant ${clock(firstTrade.at)}` : 'avant la séance',
      tone: null,
    },
  ];
}

export interface AutopsyRow {
  key: string;
  time: string;
  title: string;
  pnl: string | null;
  tone: 'pos' | 'neg' | null;
  meta: string;
  alert: boolean;
  afterAlert: boolean;
  /** Trade qui fait passer la distance estimée sous zéro. */
  crossing: boolean;
}

/** Lignes de la chronologie, dans l'ordre de l'API. */
export function autopsyRows(r: AccountIncidentReport): AutopsyRow[] {
  const cur = r.account.currency;
  let crossedDone = false;
  return r.timeline.map((e, i) => {
    if (e.type === 'alert') {
      const next = e.nextTradeMinutes == null ? 'aucun trade ensuite' : `trade suivant ${e.nextTradeMinutes} min plus tard`;
      return {
        key: `a${i}`, time: clock(e.at), title: `Alerte : ${e.label}`, pnl: null, tone: null,
        meta: `Enregistrée par MyTradingCoach, ${next}`, alert: true, afterAlert: false, crossing: false,
      };
    }
    const crossing = !crossedDone && e.distanceAfter != null && e.distanceAfter <= 0;
    if (crossing) crossedDone = true;
    return {
      key: e.tradeId, time: clock(e.at),
      title: `${e.side} ${e.asset}${e.quantity != null ? ` · ${qty(e.quantity)} contrat${e.quantity > 1 ? 's' : ''}` : ''}`,
      pnl: signedMoney(e.net, cur), tone: e.net < 0 ? 'neg' : e.net > 0 ? 'pos' : null,
      meta: e.distanceAfter != null ? `Distance à la limite : ${distanceMoney(e.distanceAfter, cur)}` : 'Distance non relevée',
      alert: false, afterAlert: e.afterAlert, crossing,
    };
  });
}

export interface DistanceChart {
  width: number;
  height: number;
  path: string;
  points: { x: number; y: number; last: boolean }[];
  /** Ligne de la limite estimée (distance 0). */
  zeroY: number;
  alerts: { x: number; label: string }[];
  startLabel: string;
  endLabel: string;
  aria: string;
}

const CHART_H = 120;
const PAD = 26;

/**
 * Courbe « distance à la limite » de la maquette : un point par trade, espacés régulièrement,
 * limite en pointillé à 0, repère de chaque alerte entre les deux trades qui l'encadrent.
 * Null s'il n'y a pas au moins deux points (échec marqué à la main, aucun relevé).
 */
export function distanceChart(r: AccountIncidentReport, width: number): DistanceChart | null {
  const pts = r.series;
  if (pts.length < 2) return null;
  const values = pts.map((p) => p.distance);
  const span = Math.max(...values, 0) - Math.min(...values, 0) || 1;
  const max = Math.max(...values, 0) + span * 0.08;
  const min = Math.min(...values, 0) - span * 0.1;
  const step = (width - PAD * 2) / (pts.length - 1);
  const x = (i: number) => PAD + i * step;
  const y = (v: number) => 10 + ((max - v) * (CHART_H - 20)) / (max - min);
  const points = pts.map((p, i) => ({ x: round(x(i)), y: round(y(p.distance)), last: i === pts.length - 1 }));
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');

  // Alerte : placée entre le trade d'avant et celui d'après, au prorata de l'heure.
  const times = pts.map((p) => (p.at ? new Date(p.at).getTime() : null));
  const alerts = r.timeline.flatMap((e) => {
    if (e.type !== 'alert') return [];
    const t = new Date(e.at).getTime();
    const after = times.findIndex((v) => v != null && v > t);
    if (after <= 0) return [];
    const before = after - 1;
    const t0 = times[before] ?? times[after]! - 1;
    const ratio = Math.min(1, Math.max(0, (t - t0) / (times[after]! - t0)));
    return [{ x: round(x(before) + ratio * step), label: `Alerte ${clock(e.at)}` }];
  });

  const cur = r.account.currency;
  const firstAt = pts.find((p) => p.at)?.at ?? null;
  const lastAt = pts[pts.length - 1].at;
  return {
    width, height: CHART_H + 18, path, points, zeroY: round(y(0)), alerts,
    startLabel: firstAt ? clock(firstAt) : '', endLabel: lastAt ? clock(lastAt) : '',
    aria: `Distance à la limite au fil de la séance : de ${distanceMoney(values[0], cur)} à ${distanceMoney(values[values.length - 1], cur)}`,
  };
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Espace insécable devant `: ; ! ?` : la ponctuation double ne passe jamais seule à la ligne. */
export function frenchSpacing(text: string): string {
  return text.replace(/ ([:;!?])/g, '\u00a0$1');
}

/** Paragraphes de l'analyse IA (lignes vides comme séparateurs). */
export function aiParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => frenchSpacing(p.trim())).filter(Boolean);
}
