import type { PropFirmCatalogFirm, PropFirmPlanSummary } from '@mtc/shared';
import { normalizeHelp } from './help-search';

/**
 * Chatbot de support (#493) : réponse sur une prop firm citée, lue dans le catalogue (jamais copiée dans la
 * base), sans IA. Plans publics et vérifiés seulement (`needsReview` exclu, comme les pages SEO). Fonctions PURES.
 */

/** Premiers mots trop courants pour désigner une firm à eux seuls. */
const GENERIC = new Set(['funded', 'trader', 'trading', 'futures', 'take', 'top', 'my']);

export const HELP_FIRM_NOT_TRADOVATE =
  "Ta firm ne passe pas par Tradovate ? Tu peux quand même relier ton compte à son plan et ajouter tes trades à la main, ou par import CSV si ton export est reconnu.";

const visiblePlans = (firm: PropFirmCatalogFirm) => firm.plans.filter((p) => p.availability === 'public' && !p.needsReview);

/** Firm citée dans la question (une seule, sinon null : on ne devine pas). */
export function citedFirm(question: string, firms: readonly PropFirmCatalogFirm[]): PropFirmCatalogFirm | null {
  const q = normalizeHelp(question);
  const compact = q.replace(/ /g, '');
  const hits = firms.filter((f) => {
    if (!visiblePlans(f).length) return false;
    const name = normalizeHelp(f.name).trim();
    const first = name.split(' ')[0];
    return compact.includes(f.id) || q.includes(` ${name} `) || (first.length >= 5 && !GENERIC.has(first) && q.includes(` ${first} `));
  });
  return hits.length === 1 ? hits[0] : null;
}

/** Taille citée (« 50k », « 50 k », « 50 000 »), en dollars. */
export function citedSize(question: string): number | null {
  const q = normalizeHelp(question);
  const k = q.match(/ (\d{2,3}) ?k /);
  if (k) return Number(k[1]) * 1000;
  const full = q.match(/ (\d{2,3}) ?000 /);
  return full ? Number(full[1]) * 1000 : null;
}

/** Date ISO (« 2026-11-22 ») en français (« 22 novembre 2026 »), lue en UTC. */
export const frDate = (iso: string): string => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** Montant lisible : milliers et symbole séparés par une espace insécable. */
const money = (n: number, currency: string) =>
  `${String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')}\u00a0${currency === 'EUR' ? '€' : '$'}`;
const ddLabel: Record<string, string> = { trailing_eod: 'EOD', trailing_intraday: 'intraday', static: 'statique' };

function planLine(p: PropFirmPlanSummary): string {
  const ev = p.phases.find((ph) => ph.phase === 'evaluation') ?? p.phases[0];
  const parts = [`${p.planName} ${p.accountSize / 1000}K`];
  if (ev?.profitTarget != null) parts.push(`objectif ${money(ev.profitTarget, p.currency)}`);
  if (ev) parts.push(`drawdown ${money(ev.maxDrawdown, p.currency)} (${ddLabel[ev.drawdownType] ?? ev.drawdownType})`);
  if (ev?.dailyLossLimit != null) parts.push(`perte max du jour ${money(ev.dailyLossLimit, p.currency)}`);
  return `- ${parts.join(', ')}`;
}

/**
 * Fiche d'une firm citée : règles du catalogue pour la taille citée (5 plans au plus), sinon les tailles
 * disponibles. Toujours la date du relevé et « seules les règles officielles de la firme font foi ».
 */
export function firmAnswer(firm: PropFirmCatalogFirm, size: number | null, supportsTradovate: boolean): string {
  const plans = visiblePlans(firm);
  const lines: string[] = [];
  const atSize = size != null ? plans.filter((p) => p.accountSize === size) : [];
  if (atSize.length) {
    lines.push(`Règles du catalogue pour ${firm.name} ${size! / 1000}K (évaluation) :`);
    lines.push(...atSize.slice(0, 5).map(planLine));
    if (atSize.length > 5) lines.push(`- et ${atSize.length - 5} autres plans de cette taille`);
  } else {
    const sizes = [...new Set(plans.map((p) => p.accountSize))].sort((a, b) => a - b).map((s) => `${s / 1000}K`);
    lines.push(`${firm.name} est dans le catalogue, en ${sizes.join(', ')}.`);
    lines.push('Précise la taille de ton compte (par exemple « 50K ») pour que je te donne ses règles.');
  }
  const where = firm.website ? `sur [le site officiel de la firme](${firm.website})` : 'sur les pages officielles de la firme';
  lines.push(`Relevé le ${frDate(firm.verifiedAt)} ${where}. Seules les règles officielles de la firme font foi.`);
  if (!supportsTradovate) lines.push(HELP_FIRM_NOT_TRADOVATE);
  return lines.join('\n');
}
