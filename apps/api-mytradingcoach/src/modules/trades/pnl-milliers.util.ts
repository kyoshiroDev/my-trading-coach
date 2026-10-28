import { roundCents } from '@mtc/shared';
import { INSTRUMENTS } from './instruments.const';

/**
 * Détection des trades importés avec un P&L tronqué au séparateur de milliers (bug prod du
 * 2026-10-28) : `parseFloat("1,125.00")` vaut 1. Fonctions PURES, partagées par le script de
 * réparation (`scripts/repair-tradovate-pnl-milliers.ts`) et la requête de détection.
 *
 * Seuls les futures du référentiel sont vérifiables : leur P&L brut se recalcule exactement à
 * partir des prix (écart × quantité × valeur du point), et ce recalcul ne dépend pas du sens
 * enregistré (un sens inversé échange aussi entrée et sortie, l'écart signé ne change pas).
 */

/** Valeur d'un point par actif futures (tickValue / tickSize), d'après `INSTRUMENTS`. */
export const VALEUR_DU_POINT: ReadonlyMap<string, number> = new Map(
  INSTRUMENTS.filter((i) => i.category === 'FUTURES_US' && i.tickValue && i.tickSize).map((i) => [
    i.symbol,
    (i.tickValue as number) / (i.tickSize as number),
  ]),
);

export interface TradePrix {
  asset: string;
  side: 'LONG' | 'SHORT';
  entry: number;
  exit: number | null;
  quantity: number | null;
}

/** P&L brut recalculé depuis les prix, au centime ; null si l'actif n'est pas vérifiable. */
export function brutDepuisPrix(t: TradePrix): number | null {
  const vpp = VALEUR_DU_POINT.get(t.asset);
  if (vpp == null || t.exit == null) return null;
  const ecart = t.side === 'LONG' ? t.exit - t.entry : t.entry - t.exit;
  return roundCents(ecart * (t.quantity && t.quantity > 0 ? t.quantity : 1) * vpp);
}

/**
 * Ce que l'ancien parseur gardait d'un montant ≥ 1 000 : la partie avant la PREMIÈRE virgule.
 * 1 125 → 1 · 12 345,67 → 12 · −1 234 567,89 → −1. Montant < 1 000 : inchangé (non touché).
 */
export function pnlTronque(brut: number): number {
  const abs = Math.abs(brut);
  if (abs < 1000) return brut;
  let tete = Math.floor(abs);
  while (tete >= 1000) tete = Math.floor(tete / 1000);
  return brut < 0 ? -tete : tete;
}

/**
 * Trade touché : P&L brut recalculé ≥ 1 000 $ en valeur absolue ET P&L enregistré égal EXACTEMENT
 * à sa troncature. La signature exacte écarte les écarts d'une autre origine (trade modifié à la
 * main, valeur du point différente chez le broker) : ceux-là ne sont jamais réparés en aveugle.
 */
export function estTronque(t: TradePrix & { pnl: number | null }): boolean {
  const brut = brutDepuisPrix(t);
  return brut != null && t.pnl != null && Math.abs(brut) >= 1000 && t.pnl === pnlTronque(brut);
}

export type CasReparation = 'CSV' | 'JUMEAU' | 'REIMPORT' | 'FIGE';
export type MotifFige =
  | 'connexion_absente'
  | 'connexion_a_reconnecter'
  | 'jeton_inutilisable'
  | 'synchro_ancienne_ou_en_erreur'
  | 'hors_fenetre_historique';

/** Marque posée sur un trade FIGE : P&L corrigé, sens et heure de clôture non vérifiés. */
export const TAG_SENS_NON_VERIFIE = 'sens-heure-non-verifies';
/** Tradovate archive un compte inactif ou en échec au bout de 10 jours : son historique devient illisible. */
export const SYNCHRO_RECENTE_JOURS = 10;
/**
 * Fenêtre garantie de la réimportation, au pire cas : Tradovate ne date pas le compte, l'import
 * remonte alors `HISTORY_FALLBACK_MONTHS` (6) mois et s'arrête après `EMPTY_WINDOWS_BEFORE_STOP`
 * (2) mois vides d'affilée (`tradovate-history.service.ts`, égalité vérifiée par le spec).
 */
export const FENETRE_REIMPORT_MOIS = 6;
export const MOIS_VIDES_AVANT_ARRET = 2;

export interface EtatConnexion {
  status: string;
  accessTokenExpiresAt: Date;
  refreshTokenEnc: string | null;
  refreshTokenExpiresAt: Date | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
}

/** Jeton utilisable SANS l'utilisateur : accès encore valide, ou renouvelable (refresh promis). */
export function jetonUtilisable(c: EtatConnexion, now: Date): boolean {
  if (c.status !== 'CONNECTED') return false;
  if (c.accessTokenExpiresAt.getTime() > now.getTime()) return true;
  return !!c.refreshTokenEnc && !!c.refreshTokenExpiresAt && c.refreshTokenExpiresAt.getTime() > now.getTime();
}

/** Mois UTC `AAAA-MM`, découpage des fenêtres de la Reporting API. */
export const moisUtc = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * Le mois du trade est-il relu à coup sûr ? Fenêtres mensuelles du mois en cours vers le passé,
 * au plus `FENETRE_REIMPORT_MOIS`, et jamais au-delà de deux mois vides d'affilée (arrêt de
 * l'import sans date de création). `moisAvecTrades` : mois où le compte a des trades broker.
 */
export function moisRelu(tradedAt: Date, now: Date, moisAvecTrades: ReadonlySet<string>): boolean {
  const cible = moisUtc(tradedAt);
  let vides = 0;
  for (let i = 0; i < FENETRE_REIMPORT_MOIS; i++) {
    if (vides >= MOIS_VIDES_AVANT_ARRET) return false;
    const m = moisUtc(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)));
    if (m === cible) return true;
    vides = moisAvecTrades.has(m) ? 0 : vides + 1;
  }
  return false;
}

/**
 * Sort d'un trade touché. Règle : ne JAMAIS supprimer une ligne qui ne peut pas revenir. REIMPORT
 * (suppression puis relecture chez Tradovate) seulement si la connexion est active, son jeton
 * utilisable, sa dernière synchro récente et sans erreur, et le mois du trade relu à coup sûr.
 * Tout le reste est FIGE : P&L corrigé sur place, sens et heure marqués non vérifiés.
 */
export function casReparation(i: {
  source: 'CSV_IMPORT' | 'BROKER_HISTORY';
  aJumeau: boolean;
  connexion: EtatConnexion | null;
  tradedAt: Date;
  moisAvecTrades: ReadonlySet<string>;
  now: Date;
}): { cas: CasReparation; motif?: MotifFige } {
  if (i.source === 'CSV_IMPORT') return { cas: 'CSV' };
  if (i.aJumeau) return { cas: 'JUMEAU' };
  const c = i.connexion;
  if (!c) return { cas: 'FIGE', motif: 'connexion_absente' };
  if (c.status !== 'CONNECTED') return { cas: 'FIGE', motif: 'connexion_a_reconnecter' };
  if (!jetonUtilisable(c, i.now)) return { cas: 'FIGE', motif: 'jeton_inutilisable' };
  const recente = c.lastSyncAt && i.now.getTime() - c.lastSyncAt.getTime() <= SYNCHRO_RECENTE_JOURS * 86_400_000;
  if (!recente || c.lastSyncError) return { cas: 'FIGE', motif: 'synchro_ancienne_ou_en_erreur' };
  if (!moisRelu(i.tradedAt, i.now, i.moisAvecTrades)) return { cas: 'FIGE', motif: 'hors_fenetre_historique' };
  return { cas: 'REIMPORT' };
}
