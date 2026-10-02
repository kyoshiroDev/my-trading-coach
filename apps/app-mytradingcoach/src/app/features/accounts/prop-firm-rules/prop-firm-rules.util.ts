import { formatMoney, type AccountType, type PropFirmPhaseRules, type PropFirmPlanDetail } from '@mtc/shared';

/**
 * Mise en mots des règles d'un plan du catalogue (fonctions pures, testées à part).
 * Les textes restent courts : les précisions de la firm sont dans les `notes`, affichées au dépli.
 */

/** Montant sans signe ni décimales : 2 000 $ s'écrit « $2,000 ». */
export function amount(value: number, currency: string): string {
  return formatMoney(value, currency, { sign: false, decimals: 0 });
}

const PARIS = 'Europe/Paris';

/** Décalage (ms) d'un fuseau IANA à un instant donné : heure murale du fuseau − UTC. */
function zoneOffsetMs(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - utcMs;
}

/**
 * Heure de Paris correspondant à « HH:MM » dans `zone`, le jour de `on` dans ce fuseau.
 * Passe par les règles de fuseau du navigateur (Intl) : changements d'heure automatiques des
 * deux côtés, y compris les semaines où l'Europe et les États-Unis ne sont pas décalés le même
 * jour (16:59 New York = 22:59 à Paris la plupart de l'année, 21:59 fin mars et fin octobre).
 */
export function parisTime(time: string, zone: string, on: Date = new Date()): string {
  const [hh, mm] = time.split(':').map(Number);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(on)
    .split('-')
    .map(Number);
  const wall = Date.UTC(day[0], day[1] - 1, day[2], hh, mm);
  // Deux passes : le décalage dépend de l'instant, qui dépend du décalage (jour de changement d'heure).
  let utc = wall - zoneOffsetMs(zone, wall);
  utc = wall - zoneOffsetMs(zone, utc);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }).format(new Date(utc));
}

/**
 * Heure d'une règle, toujours en heure de Paris (app pour des traders français) :
 * « 16:59 America/New_York » → « 22:59 » le plus souvent, « 21:59 » les semaines où l'Europe et
 * les États-Unis ne changent pas d'heure le même jour. Calculée pour le jour `on` (aujourd'hui par
 * défaut). Fuseau illisible : heure et ville d'origine, plutôt qu'une heure de Paris fausse.
 */
export function timeLabel(value: string, on: Date = new Date()): string {
  const [time, zone = ''] = value.split(' ');
  if (!zone || zone === PARIS) return time;
  try {
    return parisTime(time, zone, on);
  } catch {
    return `${time} (${zone.split('/').pop()?.replace(/_/g, ' ')})`;
  }
}

export function pctLabel(value: number): string {
  return `${Math.round(value * 1000) / 10} %`;
}

export const PHASE_LABELS: Record<PropFirmPhaseRules['phase'], string> = {
  evaluation: 'Évaluation',
  funded: 'Funded',
  direct: 'Funded direct',
};

/** Phase affichée par défaut : celle qui correspond au type du compte, sinon la première. */
export function defaultPhase(plan: PropFirmPlanDetail, type: AccountType): PropFirmPhaseRules['phase'] {
  const has = (k: PropFirmPhaseRules['phase']) => plan.phases.some((p) => p.phase === k);
  if (type === 'FUNDED') {
    if (has('funded')) return 'funded';
    if (has('direct')) return 'direct';
  }
  if (type === 'EVALUATION' && has('evaluation')) return 'evaluation';
  return plan.phases[0].phase;
}

export function drawdownKindLabel(dd: PropFirmPhaseRules['max_drawdown']): string {
  switch (dd.type) {
    case 'static':
      return 'Statique : le seuil ne bouge pas';
    case 'trailing_eod':
      return 'Trailing EOD : suit le plus haut solde de clôture';
    case 'trailing_intraday':
      return 'Trailing intraday : suit le plus haut pic en séance, latent inclus';
  }
}

export function enforcementLabel(dd: PropFirmPhaseRules['max_drawdown']): string {
  switch (dd.enforced_on) {
    case 'equity_realtime':
      return "Contrôlé en temps réel sur l'equity (positions ouvertes comprises)";
    case 'balance_realtime':
      return 'Contrôlé en temps réel sur le solde réalisé';
    case 'eod_balance':
      return 'Contrôlé une fois par jour, sur le solde de clôture';
    default:
      return 'Contrôle en séance non documenté par la firm : par prudence, surveille ton equity';
  }
}

/** Blocage du trailing : « Se fige à $50,100 quand le solde atteint $52,100 ». */
export function lockLabel(lockedFloor: number | null | undefined, locksAt: number | null, currency: string): string | null {
  if (locksAt == null && lockedFloor == null) return null;
  if (lockedFloor != null && locksAt != null) {
    return `Se fige à ${amount(lockedFloor, currency)} quand le solde atteint ${amount(locksAt, currency)}`;
  }
  return locksAt != null
    ? `Cesse de suivre quand le solde atteint ${amount(locksAt, currency)}`
    : `Se fige à ${amount(lockedFloor!, currency)}`;
}

export function breachLabel(dll: NonNullable<PropFirmPhaseRules['daily_loss_limit']>): string {
  const reset = dll.resets_at ? ` jusqu'à ${timeLabel(dll.resets_at)} (heure de Paris)` : " jusqu'à la session suivante";
  return dll.breach === 'account_failed'
    ? 'Dépasser cette perte fait échouer le compte'
    : `Dépasser cette perte suspend le trading${reset}, le compte reste actif`;
}

/** Palier de profit : « 0 à 1 499 » ou « 6 000 et plus », dans la devise du compte. */
export function tierRange(minProfit: number, maxProfit: number | null, currency: string): string {
  return maxProfit == null
    ? `${amount(minProfit, currency)} et plus`
    : `${amount(minProfit, currency)} à ${amount(maxProfit, currency)}`;
}

export function contractsLabel(c: PropFirmPhaseRules['max_contracts']): string | null {
  const parts = [c.minis != null ? `${c.minis} minis` : null, c.micros != null ? `${c.micros} micros` : null].filter(
    (p): p is string => p !== null,
  );
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Valeur par numéro de payout (index i = payout i+1 ; la dernière vaut pour les suivants, s'il y en a) :
 * [1500, 1500, 2000] → « P1 $1,500 · P2 $1,500 · P3 $2,000 », le dernier devenant « P3 et suivants »
 * quand des payouts au-delà du tableau restent possibles (`maxPayouts` absent ou plus grand).
 * `null` = sans plafond pour ce payout. Valeurs toutes égales → montant seul.
 */
export function scheduleLabel(values: readonly (number | null)[], currency: string, maxPayouts?: number | null): string {
  const fmt = (v: number | null) => (v === null ? 'sans plafond' : amount(v, currency));
  if (values.every((v) => v === values[0])) return fmt(values[0]);
  // Des payouts restent possibles au-delà du tableau : la dernière valeur vaut pour eux aussi.
  const more = maxPayouts == null || maxPayouts > values.length;
  return values.map((v, i) => `P${i + 1}${more && i === values.length - 1 ? ' et suivants' : ''} ${fmt(v)}`).join(' · ');
}

/** Oui / Non / non documenté, pour les règles booléennes nullables. */
export function yesNo(value: boolean | null): string {
  return value == null ? 'non documenté' : value ? 'oui' : 'non';
}
