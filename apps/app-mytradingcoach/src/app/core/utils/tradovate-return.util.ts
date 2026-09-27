import type { TradovateSyncResult } from '../api/tradovate.api';

/**
 * Retour du consentement Tradovate (PROMPT-208). Le flux OAuth SORT de l'app ; l'API le
 * ramène sur `/dashboard?from=wizard` (onboarding) ou `/accounts` (réglages) avec le résultat
 * en query params. Tout ce qui se lit / s'affiche au retour vit ici, pur et testable, pour que
 * le wizard et « Mes comptes » tiennent exactement le même discours.
 *
 * Aucun texte ne nomme un autre broker (clause 2.ii du contrat NinjaTrader).
 */

export type FeesState = 'ok' | 'partial' | 'none';

export interface TradovateReturn {
  status: 'connected' | 'select_account' | 'error';
  accountId: string | null;
  reason: string | null;
  /** Trades créés par la première synchro ; null si elle a échoué ou n'a pas eu lieu. */
  trades: number | null;
  syncFailed: boolean;
  fees: FeesState | null;
  fromWizard: boolean;
}

/** Paramètres posés par l'API au retour : à retirer de l'URL une fois lus. */
export const TRADOVATE_RETURN_PARAMS = [
  'tradovate', 'accountId', 'reason', 'trades', 'sync', 'fees', 'from',
] as const;

export function parseTradovateReturn(params: Record<string, string | undefined>): TradovateReturn | null {
  const status = params['tradovate'];
  if (status !== 'connected' && status !== 'select_account' && status !== 'error') return null;
  const trades = params['trades'] != null ? parseInt(params['trades'], 10) : NaN;
  const fees = params['fees'];
  return {
    status,
    accountId: params['accountId'] || null,
    reason: params['reason'] || null,
    trades: Number.isFinite(trades) ? trades : null,
    syncFailed: params['sync'] === 'error',
    fees: fees === 'ok' || fees === 'partial' || fees === 'none' ? fees : null,
    fromWizard: params['from'] === 'wizard',
  };
}

const REASONS: Record<string, string> = {
  denied: "Tu as refusé l'accès sur Tradovate : aucune donnée n'a été lue.",
  session_expired: 'La demande de connexion a expiré. Relance-la, elle reste valable 10 minutes.',
  state_mismatch: "La demande de connexion n'a pas pu être vérifiée. Relance-la depuis cet écran.",
  missing_code: "Tradovate n'a pas renvoyé d'autorisation. Relance la connexion.",
  exchange_failed: "Tradovate n'a pas validé la connexion. Réessaie dans un instant.",
  rate_limited: 'Tradovate limite temporairement les requêtes. Réessaie dans quelques minutes.',
  not_configured: "La connexion Tradovate n'est pas encore disponible.",
  no_account: 'Aucun compte Tradovate actif trouvé avec ces identifiants.',
  account_not_found: "Ce compte n'existe plus dans MyTradingCoach.",
  account_already_linked:
    'Ce compte est déjà relié à un autre compte MyTradingCoach. Délie-le là-bas avant de le relier ici : deux liaisons se déconnecteraient mutuellement.',
};

/** Message d'échec du retour, toujours non bloquant et avec une porte de sortie. */
export function tradovateErrorMessage(reason: string | null, fromWizard: boolean): string {
  const base = (reason && REASONS[reason]) || 'La connexion Tradovate a échoué.';
  return fromWizard
    ? `${base} Tu peux réessayer ou importer un CSV.`
    : base;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** « 34 trades synchronisés » / « Aucun nouveau trade » (aussi pour le retour OAuth). */
export function tradesLine(created: number): string {
  return created > 0
    ? plural(created, 'trade synchronisé', 'trades synchronisés')
    : 'Aucun nouveau trade à synchroniser';
}

/** Ligne frais, même lecture que le récap d'import CSV. null = rien à signaler. */
export function feesLine(fees: FeesState | null): { text: string; warn: boolean } | null {
  switch (fees) {
    case 'partial':
      return { text: 'Frais non rapprochés sur certains trades · vérifie le P&L net.', warn: true };
    case 'none':
      return { text: 'Frais non importés · P&L brut affiché.', warn: true };
    default:
      return null;
  }
}

export function feesState(r: TradovateSyncResult): FeesState {
  const f = r.feesImported;
  if (f.merged === false) return 'none';
  return f.reconciled ? 'ok' : 'partial';
}

/** Résumé d'une synchro manuelle, affiché sous la ligne du compte. */
export function syncResultLines(r: TradovateSyncResult): { text: string; warn: boolean }[] {
  const lines: { text: string; warn: boolean }[] = [];
  let main = tradesLine(r.created);
  if (r.duplicates > 0) main += ` · ${plural(r.duplicates, 'déjà présent', 'déjà présents')}`;
  lines.push({ text: main, warn: false });
  if (r.created > 0 || r.duplicates > 0) {
    const f = feesLine(feesState(r));
    if (f) lines.push(f);
  }
  if (r.openPositions > 0) {
    lines.push({
      text: `${plural(r.openPositions, 'position encore ouverte', 'positions encore ouvertes')} : importée(s) à la clôture.`,
      warn: false,
    });
  }
  if (r.skipped > 0 || r.failed > 0) {
    lines.push({
      text: `${plural(r.skipped + r.failed, 'trade non importé', 'trades non importés')} (données incomplètes côté Tradovate).`,
      warn: true,
    });
  }
  return lines;
}

/** « il y a 2 h », « à l'instant », « le 12/09 ». */
export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'jamais';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return `le ${new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
}
