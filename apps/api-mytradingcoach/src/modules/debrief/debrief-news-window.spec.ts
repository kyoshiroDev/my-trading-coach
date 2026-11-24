import { describe, expect, it } from 'vitest';
import { freezeClock } from '../../test/freeze-clock';
import { newsWindowStats } from './debrief-news-window';

// Dates fixes : horloge figée (règle du dépôt). NFP du vendredi 04/12/2026 à 14:30 Paris (13:30 UTC).
freezeClock('2026-12-06T22:00:00Z');
const NFP = { at: new Date('2026-12-04T13:30:00Z'), label: 'NFP', currency: 'USD' };
const BCE = { at: new Date('2026-12-03T13:15:00Z'), label: 'BCE', currency: 'EUR' };
const trade = (asset: string, iso: string, pnl: number | null, commission = 0, accountId: string | null = 'apex') =>
  ({ asset, tradedAt: new Date(iso), pnl, commission, accountId });

describe('stat du débrief : trades autour des annonces, par compte (#670)', () => {
  it('fenêtre T−X à T+X, devises de l’actif, P&L net et taux de réussite par compte', () => {
    const s = newsWindowStats([
      trade('NQ', '2026-12-04T13:27:00Z', -120, 2),            // 3 min avant le NFP
      trade('MNQ', '2026-12-04T13:34:00Z', 60, 1),             // 4 min après
      trade('NQ', '2026-12-04T13:40:00Z', 50, 1),              // 10 min après : hors fenêtre
      trade('NQ', '2026-12-03T13:16:00Z', 30, 1),              // BCE : devise EUR, ne concerne pas NQ
      trade('6E', '2026-12-03T13:16:00Z', -40, 1, 'perso'),    // BCE : concerne 6E, autre compte
      trade('NQ', '2026-12-04T13:29:00Z', null),               // ouvert : hors calcul
    ], [NFP, BCE], 5);
    expect(s).toEqual({
      windowMinutes: 5,
      accounts: [
        { accountId: 'apex', inside: { count: 2, pnl: -63, winRate: 50 }, outside: { count: 2, pnl: 78, winRate: 100 } },
        { accountId: 'perso', inside: { count: 1, pnl: -41, winRate: 0 }, outside: { count: 0, pnl: 0, winRate: 0 } },
      ],
    });
  });

  it('aucun trade clôturé : pas de stat (le bloc reste masqué)', () => {
    expect(newsWindowStats([trade('NQ', '2026-12-04T13:29:00Z', null)], [NFP], 5)).toBeNull();
  });

  it('trade sans compte : regroupé sous accountId null', () => {
    expect(newsWindowStats([trade('ES', '2026-12-04T13:29:00Z', 10, 0, null)], [NFP], 5)?.accounts[0]).toMatchObject({ accountId: null, inside: { count: 1 } });
  });
});
