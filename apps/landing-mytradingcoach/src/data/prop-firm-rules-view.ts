/**
 * Règles d'un plan prop firm mises en mots pour la landing — fonctions PURES, sans le
 * catalogue : importées par le rendu serveur ET par le script client du sélecteur, qui ne
 * reçoit que la version compacte (`prop-firm-catalog.ts`, JSON embarqué dans la page).
 */
export type PhaseKind = 'evaluation' | 'funded' | 'direct';

export interface CompactPhase {
  phase: PhaseKind;
  target: number | null;
  /** `lockFloor` : plancher une fois le trailing figé (null = jamais figé ou dépend de la plateforme). */
  dd: { amount: number; type: string; lockFloor: number | null } | null;
  dll: { amount: number; tiered: boolean } | null;
  consistency: { pct: number; appliesTo: string | null } | null;
  payout: { minDays: number | null; minDailyProfit: number | null; splitPct: number | null; minAmount: number | null } | null;
  contracts: { minis: number | null; micros: number | null; scaling: boolean } | null;
  /** `at` : « HH:MM Zone/IANA » de la clôture imposée, null s'il n'y en a pas. */
  close: { at: string | null; overnight: boolean | null } | null;
}

export interface CompactPlan {
  id: string;
  label: string;
  size: number;
  currency: string;
  phases: CompactPhase[];
}

export interface CompactFirm {
  id: string;
  name: string;
  verifiedAt: string;
  plans: CompactPlan[];
}

export interface RuleRow {
  label: string;
  value: string;
  detail?: string;
}

export const PHASE_LABEL: Record<PhaseKind, string> = {
  evaluation: 'Évaluation',
  funded: 'Funded',
  direct: 'Funded direct',
};

const DD_TYPE: Record<string, string> = {
  trailing_eod: 'Trailing sur le plus haut solde de fin de journée (EOD)',
  trailing_intraday: 'Trailing en temps réel, latent compris (intraday)',
  static: 'Statique : plancher fixe',
};

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

/** 2000 → « 2 000 $ » (espaces fines insécables à la française). */
export function money(n: number, currency: string): string {
  const v = Math.round(n).toLocaleString('fr-FR').replace(/\s/g, ' ');
  return `${v} ${SYMBOL[currency] ?? currency}`;
}

const pct = (p: number) => `${Math.round(p * 100)} %`;

const CITY: Record<string, string> = {
  'America/New_York': 'New York',
  'America/Chicago': 'Chicago',
  'Etc/UTC': 'UTC',
};
const PARIS = 'Europe/Paris';

/** Décalage (ms) du fuseau `zone` à l'instant `utcMs`. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

/**
 * Heure de Paris correspondant à « HH:MM » dans `zone`, aujourd'hui : même calcul que l'app
 * (prop-firm-rules.util.ts, timeLabel), pour que la landing affiche la même heure que la capture.
 * 16:59 New York = 22:59 à Paris la plupart de l'année, 21:59 les semaines de décalage.
 */
function parisTime(time: string, zone: string, on: Date = new Date()): string {
  const [hh, mm] = time.split(':').map(Number);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(on).split('-').map(Number);
  const wall = Date.UTC(day[0], day[1] - 1, day[2], hh, mm);
  // Deux passes : le décalage dépend de l'instant, qui dépend du décalage (jour de changement d'heure).
  let utc = wall - zoneOffsetMs(zone, wall);
  utc = wall - zoneOffsetMs(zone, utc);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(new Date(utc));
}

/** « 16:59 America/New_York » → valeur « 22:59 » (heure de Paris), précision « 16:59 à New York ». */
function closeAt(at: string): { value: string; detail: string } {
  const [time, zone = ''] = at.split(' ');
  if (!zone || zone === PARIS) return { value: time, detail: 'heure de Paris' };
  const city = CITY[zone] ?? zone.split('/').pop()?.replace(/_/g, ' ') ?? zone;
  try {
    return { value: parisTime(time, zone), detail: `heure de Paris · ${time} à ${city}` };
  } catch {
    return { value: time, detail: `heure de ${city}` };
  }
}

/** Lignes affichées pour une phase : objectif, drawdown, perte du jour, consistency, taille max, clôture, payout. */
export function ruleRows(p: CompactPhase, currency: string): RuleRow[] {
  const m = (n: number) => money(n, currency);
  const rows: RuleRow[] = [];
  rows.push(
    p.target !== null
      ? { label: 'Objectif', value: m(p.target) }
      : { label: 'Objectif', value: p.phase === 'evaluation' ? 'Aucun' : 'Aucun : place aux payouts' },
  );
  if (p.dd) {
    const type = DD_TYPE[p.dd.type] ?? p.dd.type;
    rows.push({
      label: 'Drawdown max',
      value: m(p.dd.amount),
      detail: p.dd.lockFloor !== null && p.dd.type !== 'static' ? `${type} · figé à ${m(p.dd.lockFloor)}` : type,
    });
  }
  rows.push(
    p.dll
      ? { label: 'Perte du jour max', value: m(p.dll.amount), detail: p.dll.tiered ? 'Évolue par palier de profit' : undefined }
      : { label: 'Perte du jour max', value: 'Aucune' },
  );
  rows.push(
    p.consistency
      ? {
          label: 'Consistency',
          value: `Meilleur jour < ${pct(p.consistency.pct)} du profit`,
          detail: p.consistency.appliesTo === 'payout' ? 'Pour demander un payout' : 'Pour valider l’objectif',
        }
      : { label: 'Consistency', value: 'Aucune' },
  );
  if (p.contracts) {
    const { minis, micros, scaling } = p.contracts;
    rows.push(
      minis !== null
        ? {
            label: 'Taille max',
            value: micros !== null ? `${minis} minis · ${micros} micros` : `${minis} minis`,
            detail: scaling ? 'Montée par palier de profit (scaling)' : undefined,
          }
        : { label: 'Taille max', value: 'Non publiée' },
    );
  }
  if (p.close) {
    if (p.close.at) {
      const c = closeAt(p.close.at);
      rows.push({ label: 'Clôture', value: `Avant ${c.value}`, detail: `${c.detail}${p.close.overnight === false ? ' · pas d’overnight' : ''}` });
    } else {
      rows.push({ label: 'Clôture', value: p.close.overnight ? 'Overnight autorisé' : 'Pas d’heure imposée' });
    }
  }
  if (p.phase !== 'evaluation' && p.payout) {
    const parts: string[] = [];
    const { minDays, minDailyProfit, splitPct, minAmount } = p.payout;
    if (minDays) parts.push(minDailyProfit ? `${minDays} jours à ${m(minDailyProfit)} min` : `${minDays} jours de trading`);
    if (minAmount) parts.push(`retrait min ${m(minAmount)}`);
    rows.push({
      label: 'Payout',
      value: splitPct ? `Split ${pct(splitPct)}` : 'Conditions du plan',
      detail: parts.length ? parts.join(' · ') : undefined,
    });
  }
  return rows;
}
