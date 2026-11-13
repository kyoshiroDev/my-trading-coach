import { describe, it, expect } from 'vitest';
import {
  estClotureEcartDePrix,
  estMexcAmbigu,
  estMexcAuNet,
  LOT1_EN_PROD,
  pnlCloture,
  sousLeCentime,
  totauxDifferents,
  valeursMexcCorrigees,
  type TradeLu,
} from './repair-950.util';
import { parseMexc } from './csv-parsers';

// Réparation #950 : données déjà fausses en prod, trouvées par l'audit des chiffres #947.

const avant = new Date('2026-11-01T10:00:00Z');
const t = (over: Partial<TradeLu> = {}): TradeLu => ({
  source: 'CSV_IMPORT', asset: 'BTC/USDT', side: 'SHORT', entry: 73602.51, exit: 73692.56,
  pnl: -6.5727459, commission: 1.6203, quantity: 200, capitalEngaged: null, tags: [], createdAt: avant, ...over,
});

describe('sousLeCentime', () => {
  it('repère une valeur de fichier non arrondie, pas un montant au centime', () => {
    expect(sousLeCentime(1.6203)).toBe(true);
    expect(sousLeCentime(0.0368)).toBe(true);
    expect(sousLeCentime(1.62)).toBe(false);
    expect(sousLeCentime(3.33)).toBe(false); // part d'un total de frais réparti
    expect(sousLeCentime(0.1 + 0.2)).toBe(false); // résidu flottant d'un montant au centime
    expect(sousLeCentime(null)).toBe(false);
  });
});

describe('MEXC stocké au P&L net', () => {
  it('trade importé par l’ancien parseur : repéré', () => {
    expect(estMexcAuNet(t())).toBe(true);
  });

  it('contre-épreuves : import d’après le lot 1, saisie manuelle, futures, sans frais', () => {
    expect(estMexcAuNet(t({ createdAt: LOT1_EN_PROD }))).toBe(false);
    expect(estMexcAuNet(t({ source: 'MANUAL' }))).toBe(false);
    expect(estMexcAuNet(t({ asset: 'MNQ' }))).toBe(false);
    expect(estMexcAuNet(t({ commission: null }))).toBe(false);
    expect(estMexcAuNet(t({ commission: 0 }))).toBe(false);
  });

  it('symbole exotique gardé brut par l’ancien parseur (NAS100USDT, BTC_USDT) : repéré', () => {
    expect(estMexcAuNet(t({ asset: 'NAS100USDT' }))).toBe(true);
    expect(estMexcAuNet(t({ asset: 'GOLD(XAUT)USDT' }))).toBe(true);
    expect(estMexcAuNet(t({ asset: 'BTC_USDT' }))).toBe(true);
  });

  it('contre-épreuve : forex MT5 (EUR/USD) sans frais, ou frais au centime : pas repéré', () => {
    expect(estMexcAuNet(t({ asset: 'EUR/USD', commission: 0 }))).toBe(false);
    expect(estMexcAuNet(t({ asset: 'EUR/USD', commission: 7 }))).toBe(false);
    expect(estMexcAmbigu(t({ asset: 'EUR/USD', commission: 7 }))).toBe(false);
  });

  it('frais au centime (Binance/Bybit avec frais répartis, ou MEXC pile au centime) : ambigu, jamais modifié', () => {
    expect(estMexcAuNet(t({ commission: 1.62 }))).toBe(false);
    expect(estMexcAmbigu(t({ commission: 1.62 }))).toBe(true);
    expect(estMexcAmbigu(t())).toBe(false);
    // Déjà réparé (P&L et frais au centime) : ni à réparer ni ambigu, le 2ᵉ passage ne signale rien.
    expect(estMexcAmbigu(t(valeursMexcCorrigees(t())))).toBe(false);
  });

  it('valeurs corrigées = celles du parseur actuel sur la même ligne (le ré-import reconnaît le trade)', () => {
    const header = 'Futures,Close Time,Avg Entry Price,Avg Close Price,Direction,Closing Qty,Trading Fee,Realized PNL,Status';
    const row = 'BTCUSDT,2026-05-30 14:31:55,73602.51,73692.56,short,200,1.6203 USDT,-6.5727459 USDT,Closed';
    const [, out] = parseMexc([header, row]).split('\n');
    const [, , , , , pnl, , commission] = out.split(',');
    expect(valeursMexcCorrigees(t())).toEqual({ pnl: Number(pnl), commission: Number(commission) });
    expect(valeursMexcCorrigees(t())).toEqual({ pnl: -4.95, commission: 1.62 });
  });

  it('après réparation, le trade n’est plus repéré (script rejouable)', () => {
    expect(estMexcAuNet(t(valeursMexcCorrigees(t())))).toBe(false);
  });
});

describe('trade clôturé depuis la séance avec l’écart de prix', () => {
  const mnq = (over: Partial<TradeLu> = {}) =>
    t({ source: 'MANUAL', asset: 'MNQ', side: 'LONG', entry: 21000, exit: 21010, quantity: 2, pnl: 10, commission: null, tags: ['TP'], ...over });

  it('MNQ 2 contrats +10 pts stocké 10 : repéré, juste 40 $', () => {
    expect(estClotureEcartDePrix(mnq())).toBe(true);
    expect(pnlCloture(mnq())).toBe(40);
  });

  it('SHORT : écart signé par le sens', () => {
    expect(estClotureEcartDePrix(mnq({ side: 'SHORT', pnl: -10, tags: ['SL'] }))).toBe(true);
  });

  it('contre-épreuves : pas d’étiquette de clôture, P&L déjà en argent, montant identique', () => {
    expect(estClotureEcartDePrix(mnq({ tags: [] }))).toBe(false);
    expect(estClotureEcartDePrix(mnq({ pnl: 40 }))).toBe(false);
    // Crypto quantité 1 sans capital : écart de prix = P&L, rien à corriger.
    expect(estClotureEcartDePrix(mnq({ asset: 'BTC/USDT', quantity: 1, tags: ['MANUAL'] }))).toBe(false);
    expect(estClotureEcartDePrix(mnq({ exit: null }))).toBe(false);
  });

  it('contre-épreuve : trade créé après le lot 1 (clôture déjà corrigée), même écart : pas repéré', () => {
    expect(estClotureEcartDePrix(mnq({ createdAt: LOT1_EN_PROD }))).toBe(false);
  });

  it('après réparation, le trade n’est plus repéré', () => {
    expect(estClotureEcartDePrix(mnq({ pnl: pnlCloture(mnq()) as number }))).toBe(false);
  });
});

describe('totauxDifferents', () => {
  const base = { totalPnl: 70, totalTrades: 3, winRate: 66.67, maxDrawdown: -20, bestTradePnl: 50, bestTradeAsset: 'MNQ' };
  it('mêmes totaux (résidu flottant compris) : rien à écrire', () => {
    expect(totauxDifferents(base, { ...base, totalPnl: 70.000000001 })).toBe(false);
  });
  it('total figé à la clôture : différent', () => {
    expect(totauxDifferents({ ...base, totalPnl: 150 }, base)).toBe(true);
    expect(totauxDifferents({ ...base, totalTrades: 4 }, base)).toBe(true);
    expect(totauxDifferents({ ...base, bestTradeAsset: 'ES' }, base)).toBe(true);
    expect(totauxDifferents({ ...base, winRate: null }, base)).toBe(true);
  });
});
