import { describe, it, expect } from 'vitest';
import {
  feesLine,
  feesState,
  parseTradovateReturn,
  relativeTime,
  syncResultLines,
  tradesLine,
  tradovateErrorMessage,
} from './tradovate-return.util';
import type { TradovateSyncResult } from '../api/tradovate.api';

function result(p: Partial<TradovateSyncResult> = {}): TradovateSyncResult {
  return {
    created: 0, duplicates: 0, failed: 0, total: 0, skipped: 0, openPositions: 0,
    feesImported: { assigned: 0, expected: 0, reconciled: true, count: 0 },
    lastSyncAt: '2026-09-12T10:00:00.000Z',
    ...p,
  };
}

describe('parseTradovateReturn — query params posés par le callback API', () => {
  it('connexion réussie depuis le wizard, avec première synchro', () => {
    expect(
      parseTradovateReturn({ tradovate: 'connected', accountId: 'a1', trades: '34', fees: 'ok', from: 'wizard' }),
    ).toEqual({
      status: 'connected', accountId: 'a1', reason: null, trades: 34,
      syncFailed: false, fees: 'ok', fromWizard: true,
    });
  });

  it('échec depuis les réglages', () => {
    expect(parseTradovateReturn({ tradovate: 'error', reason: 'denied', accountId: 'a1' })).toMatchObject({
      status: 'error', reason: 'denied', fromWizard: false, trades: null,
    });
  });

  it('première synchro en échec : connecté, mais sync=error', () => {
    expect(parseTradovateReturn({ tradovate: 'connected', sync: 'error' })).toMatchObject({
      syncFailed: true, trades: null,
    });
  });

  it('ignore une URL sans retour Tradovate ou avec un statut inconnu', () => {
    expect(parseTradovateReturn({})).toBeNull();
    expect(parseTradovateReturn({ tradovate: 'n-importe-quoi' })).toBeNull();
  });

  it('valeurs invalides neutralisées (pas de NaN affiché, frais inconnus ignorés)', () => {
    expect(parseTradovateReturn({ tradovate: 'connected', trades: 'abc', fees: 'bizarre' })).toMatchObject({
      trades: null, fees: null,
    });
  });
});

describe('messages', () => {
  it('erreur : raison connue traduite, porte de sortie CSV dans le wizard seulement', () => {
    const wizard = tradovateErrorMessage('denied', true);
    expect(wizard).toContain("Tu as refusé l'accès");
    expect(wizard).toContain('importer un CSV');
    expect(tradovateErrorMessage('denied', false)).not.toContain('CSV');
  });

  it('compte déjà relié ailleurs → on dit quoi faire, pas seulement que ça a échoué', () => {
    const msg = tradovateErrorMessage('account_already_linked', false);
    expect(msg).toContain('déjà relié');
    expect(msg).toContain('Délie-le'); // la porte de sortie est nommée
  });

  it('erreur inconnue → message générique lisible, jamais « undefined »', () => {
    expect(tradovateErrorMessage('xyz', false)).toBe('La connexion Tradovate a échoué.');
    expect(tradovateErrorMessage(null, true)).toContain('La connexion Tradovate a échoué.');
  });

  it('aucun broker concurrent nommé dans les messages du flux (clause 2.ii)', () => {
    const reasons = ['denied', 'session_expired', 'state_mismatch', 'missing_code', 'exchange_failed',
      'rate_limited', 'not_configured', 'no_account', 'account_not_found', 'account_already_linked', null];
    const all = [
      ...reasons.flatMap((r) => [tradovateErrorMessage(r, true), tradovateErrorMessage(r, false)]),
      ...syncResultLines(result({ created: 3, duplicates: 1, openPositions: 1, skipped: 1,
        feesImported: { assigned: 0, expected: 0, reconciled: false, merged: false, count: 3 } })).map((l) => l.text),
    ].join(' ');
    expect(all).not.toMatch(/binance|bybit|mexc|mt4|mt5|metatrader|ibkr|interactive brokers|rithmic|ctrader/i);
  });

  it('trades : pluriel et cas zéro', () => {
    expect(tradesLine(34)).toBe('34 trades synchronisés');
    expect(tradesLine(1)).toBe('1 trade synchronisé');
    expect(tradesLine(0)).toBe('Aucun nouveau trade à synchroniser');
  });

  it('frais : même lecture que le récap CSV (rien à signaler si rapprochés)', () => {
    expect(feesLine('ok')).toBeNull();
    expect(feesLine('partial')).toMatchObject({ warn: true });
    expect(feesLine('none')?.text).toContain('P&L brut');
    expect(feesState(result())).toBe('ok');
    expect(feesState(result({ feesImported: { assigned: 1, expected: 2, reconciled: false, count: 1 } }))).toBe('partial');
    expect(feesState(result({ feesImported: { assigned: 0, expected: 0, reconciled: false, merged: false, count: 1 } }))).toBe('none');
  });

  it('résumé de synchro : trades, doublons, frais, positions ouvertes, trades écartés', () => {
    const lines = syncResultLines(result({
      created: 34, duplicates: 2, openPositions: 1, skipped: 1,
      feesImported: { assigned: 1, expected: 2, reconciled: false, count: 34 },
    }));
    expect(lines.map((l) => l.text)).toEqual([
      '34 trades synchronisés · 2 déjà présents',
      'Frais non rapprochés sur certains trades · vérifie le P&L net.',
      '1 position encore ouverte : importée(s) à la clôture.',
      '1 trade non importé (données incomplètes côté Tradovate).',
    ]);
  });

  it('résumé : rien de nouveau → une seule ligne, pas d’alerte frais', () => {
    expect(syncResultLines(result())).toEqual([{ text: 'Aucun nouveau trade à synchroniser', warn: false }]);
  });

  it('date relative de la dernière synchro', () => {
    const now = new Date('2026-09-12T12:00:00Z').getTime();
    expect(relativeTime(null, now)).toBe('jamais');
    expect(relativeTime('2026-09-12T11:59:40Z', now)).toBe("à l'instant");
    expect(relativeTime('2026-09-12T11:45:00Z', now)).toBe('il y a 15 min');
    expect(relativeTime('2026-09-12T10:00:00Z', now)).toBe('il y a 2 h');
    expect(relativeTime('2026-09-10T12:00:00Z', now)).toBe('il y a 2 j');
    expect(relativeTime('2026-08-01T12:00:00Z', now)).toBe('le 01/08');
  });
});
