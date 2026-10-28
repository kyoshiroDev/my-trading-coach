import { describe, expect, it } from 'vitest';
import {
  brutDepuisPrix,
  casReparation,
  estTronque,
  FENETRE_REIMPORT_MOIS,
  MOIS_VIDES_AVANT_ARRET,
  moisRelu,
  pnlTronque,
  VALEUR_DU_POINT,
  type EtatConnexion,
} from './pnl-milliers.util';
import {
  EMPTY_WINDOWS_BEFORE_STOP,
  HISTORY_FALLBACK_MONTHS,
} from '../integrations/tradovate/tradovate-history.service';
import { parseTradovatePnl } from './csv-parsers';

describe('pnl-milliers.util — détection des P&L tronqués', () => {
  it('valeurs du point dérivées du référentiel', () => {
    expect(VALEUR_DU_POINT.get('ES')).toBe(50);
    expect(VALEUR_DU_POINT.get('MNQ')).toBe(2);
    expect(VALEUR_DU_POINT.has('BTC/USDT')).toBe(false);
  });

  it('ligne du compte « test NT8 » (27/10) : enregistrée SHORT 7758,25 → 7753,75, P&L 1', () => {
    const enBase = { asset: 'ES', side: 'SHORT' as const, entry: 7758.25, exit: 7753.75, quantity: 5, pnl: 1 };
    // Le sens inversé échange aussi entrée et sortie : le brut recalculé reste le vrai, +1 125 $.
    expect(brutDepuisPrix(enBase)).toBe(1125);
    expect(estTronque(enBase)).toBe(true);
  });

  it.each([
    [1125, 1],
    [-1125, -1],
    [12345.67, 12],
    [-1234567.89, -1],
    [999.5, 999.5],
  ])('troncature de %d → %d', (brut, attendu) => {
    expect(pnlTronque(brut)).toBe(attendu);
  });

  it('la troncature reproduit EXACTEMENT l’ancien parseur', () => {
    const ancien = (raw: string) => parseFloat(raw.replace(/\$/g, '').replace(/^\((.*)\)$/, '-$1'));
    for (const [raw, brut] of [['$1,125.00', 1125], ['$(12,345.67)', -12345.67], ['$1,234,567.89', 1234567.89]] as const) {
      expect(ancien(raw)).toBe(pnlTronque(brut));
      expect(parseTradovatePnl(raw)).toBe(brut);
    }
  });

  it('pas touché : brut < 1 000, P&L juste, écart d’une autre origine, actif non vérifiable', () => {
    const base = { asset: 'ES', side: 'LONG' as const, entry: 7753.75, exit: 7758.25, quantity: 5 };
    expect(estTronque({ ...base, quantity: 1, pnl: 225 })).toBe(false);
    expect(estTronque({ ...base, pnl: 1125 })).toBe(false);
    expect(estTronque({ ...base, pnl: 1100 })).toBe(false);
    expect(estTronque({ ...base, asset: 'BTC/USDT', pnl: 1 })).toBe(false);
    expect(estTronque({ ...base, exit: null, pnl: 1 })).toBe(false);
  });
});

describe('casReparation — ne jamais supprimer une ligne qui ne peut pas revenir', () => {
  const now = new Date('2026-10-28T20:00:00Z');
  const heure = 3600_000;
  const jour = 24 * heure;
  const active: EtatConnexion = {
    status: 'CONNECTED',
    accessTokenExpiresAt: new Date(now.getTime() + heure),
    refreshTokenEnc: 'chiffre',
    refreshTokenExpiresAt: new Date(now.getTime() + jour),
    lastSyncAt: new Date(now.getTime() - heure),
    lastSyncError: null,
  };
  const tousLesMois = new Set(['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05']);
  const base = {
    source: 'BROKER_HISTORY' as const,
    aJumeau: false,
    connexion: active,
    tradedAt: new Date('2026-10-27T18:53:50Z'),
    moisAvecTrades: tousLesMois,
    now,
  };

  it('fenêtre alignée sur l’import d’historique (repli sans date de création)', () => {
    expect(FENETRE_REIMPORT_MOIS).toBe(HISTORY_FALLBACK_MONTHS);
    expect(MOIS_VIDES_AVANT_ARRET).toBe(EMPTY_WINDOWS_BEFORE_STOP);
  });

  it('REIMPORT seulement quand tout est réuni', () => {
    expect(casReparation(base)).toEqual({ cas: 'REIMPORT' });
  });

  it('CSV et JUMEAU ne dépendent pas de la connexion', () => {
    expect(casReparation({ ...base, source: 'CSV_IMPORT', connexion: null })).toEqual({ cas: 'CSV' });
    expect(casReparation({ ...base, aJumeau: true, connexion: null })).toEqual({ cas: 'JUMEAU' });
  });

  it.each([
    ['connexion_absente', { connexion: null }],
    ['connexion_a_reconnecter', { connexion: { ...active, status: 'NEEDS_RECONNECT' } }],
    ['jeton_inutilisable', { connexion: { ...active, accessTokenExpiresAt: new Date(now.getTime() - heure), refreshTokenExpiresAt: new Date(now.getTime() - 1) } }],
    ['jeton_inutilisable', { connexion: { ...active, accessTokenExpiresAt: new Date(now.getTime() - heure), refreshTokenEnc: null } }],
    ['synchro_ancienne_ou_en_erreur', { connexion: { ...active, lastSyncAt: null } }],
    ['synchro_ancienne_ou_en_erreur', { connexion: { ...active, lastSyncAt: new Date(now.getTime() - 11 * jour) } }],
    ['synchro_ancienne_ou_en_erreur', { connexion: { ...active, lastSyncError: 'Rapport refusé' } }],
    ['hors_fenetre_historique', { tradedAt: new Date('2026-04-30T12:00:00Z') }],
    ['hors_fenetre_historique', { tradedAt: new Date('2026-07-15T12:00:00Z'), moisAvecTrades: new Set(['2026-10', '2026-07']) }],
  ])('FIGE (%s)', (motif, change) => {
    expect(casReparation({ ...base, ...change } as typeof base)).toEqual({ cas: 'FIGE', motif });
  });

  it('jeton expiré mais refresh promis : utilisable', () => {
    const c = { ...active, accessTokenExpiresAt: new Date(now.getTime() - heure) };
    expect(casReparation({ ...base, connexion: c })).toEqual({ cas: 'REIMPORT' });
  });

  it('moisRelu : six fenêtres au plus, arrêt après deux mois vides d’affilée', () => {
    const t = (iso: string) => new Date(iso);
    expect(moisRelu(t('2026-05-02T00:00:00Z'), now, tousLesMois)).toBe(true);
    expect(moisRelu(t('2026-04-30T23:59:59Z'), now, tousLesMois)).toBe(false);
    // Un seul mois vide (septembre) ne coupe pas : août est relu.
    expect(moisRelu(t('2026-08-10T00:00:00Z'), now, new Set(['2026-10', '2026-08']))).toBe(true);
    // Septembre ET août vides : l'import s'arrête avant juillet.
    expect(moisRelu(t('2026-07-10T00:00:00Z'), now, new Set(['2026-10', '2026-07']))).toBe(false);
    // Le mois en cours et le précédent sont toujours relus.
    expect(moisRelu(t('2026-09-10T00:00:00Z'), now, new Set())).toBe(true);
  });
});
