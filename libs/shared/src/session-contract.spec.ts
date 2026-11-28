import { describe, it, expect } from 'vitest';
import { evaluateContract, ruleAt, type ContractTrade } from './session-contract';
import type { SessionContractRules } from './contracts/session';
import { nearHighImpactNews, overMax, trailingLosses } from './session-rules';
import { assetRoot } from './asset-currencies';

const none: SessionContractRules = { maxDailyLoss: null, maxConsecutiveLosses: null, maxTrades: null, newsMinutes: null, allowedAssets: [] };
const at = (hhmm: string) => `2026-11-27T${hhmm}:00.000Z`;
/** Scénario de la maquette : 7 trades, +84 puis deux pertes de 90, … (frais nuls pour lire les montants). */
const SCENARIO: ContractTrade[] = [
  { id: 't1', asset: 'MNQZ6', tradedAt: at('14:30'), pnl: 84 },
  { id: 't2', asset: 'MNQZ6', tradedAt: at('14:55'), pnl: -90 },
  { id: 't3', asset: 'MES', tradedAt: at('15:20'), pnl: -90 },
  { id: 't4', asset: 'MNQZ6', tradedAt: at('15:42'), pnl: -8 },
  { id: 't5', asset: 'MNQZ6', tradedAt: at('15:50'), pnl: -100 },
  { id: 't6', asset: 'MES', tradedAt: at('15:58'), pnl: -88.5 },
  { id: 't7', asset: 'MNQZ6', tradedAt: at('16:10'), pnl: 40 },
];

describe('primitives des règles de séance (#667)', () => {
  it('trailingLosses : pertes en fin de série seulement', () => {
    expect(trailingLosses([10, -1, -2])).toBe(2);
    expect(trailingLosses([-1, -2, 5])).toBe(0);
    expect(trailingLosses([])).toBe(0);
  });

  it('overMax : au-delà de la limite, null ou 0 = pas de limite', () => {
    expect(overMax(6, 5)).toBe(true);
    expect(overMax(5, 5)).toBe(false);
    expect(overMax(9, null)).toBe(false);
    expect(overMax(9, 0)).toBe(false);
  });

  it('nearHighImpactNews : T−X à T+X, bornes comprises, devises de l’actif seulement', () => {
    const ev = [{ at: new Date(at('15:30')), currency: 'USD' }];
    expect(nearHighImpactNews(new Date(at('15:25')), 'MNQZ6', ev, 5)).toBe(true);
    expect(nearHighImpactNews(new Date(at('15:35')), 'MNQZ6', ev, 5)).toBe(true);
    expect(nearHighImpactNews(new Date(at('15:36')), 'MNQZ6', ev, 5)).toBe(false);
    expect(nearHighImpactNews(new Date(at('15:30')), 'FDAX', ev, 5)).toBe(false);
    expect(nearHighImpactNews(new Date(at('15:30')), 'MNQZ6', ev, 0)).toBe(false);
  });

  it('assetRoot : échéance retirée, majuscules', () => {
    expect(assetRoot('mnqz6')).toBe('MNQ');
    expect(assetRoot('MNQ 12-26')).toBe('MNQ');
    expect(assetRoot('EURUSD')).toBe('EURUSD');
    // Indices CFD : jamais pris pour une échéance (« EU50 » n'est pas « E » + U50).
    expect(assetRoot('UK100')).toBe('UK100');
    expect(assetRoot('EU50')).toBe('EU50');
    expect(assetRoot('SPX500')).toBe('SPX500');
    expect(assetRoot('6EZ6')).toBe('6E');
  });
});

describe('evaluateContract (#667)', () => {
  it('scénario de la maquette : 2 tenues sur 4, annonces sans objet, « ensuite » net', () => {
    const contract: SessionContractRules = { maxDailyLoss: 300, maxConsecutiveLosses: 2, maxTrades: 5, newsMinutes: 5, allowedAssets: ['MNQ', 'MES'] };
    const ev = evaluateContract(contract, SCENARIO);
    expect(ev).toMatchObject({ respected: 2, applicable: 4 });
    const byRule = Object.fromEntries(ev.rules.map((r) => [r.rule, r]));
    expect(byRule['maxConsecutiveLosses']).toMatchObject({ status: 'breached', breachTradeId: 't4', after: { count: 3, pnl: -148.5 } });
    expect(byRule['maxTrades']).toMatchObject({ status: 'breached', breachTradeId: 't6', limit: 5, after: { count: 1, pnl: 40 } });
    expect(byRule['maxDailyLoss']).toMatchObject({ status: 'respected', measure: -252.5 });
    expect(byRule['allowedAssets']).toMatchObject({ status: 'respected', measure: 7 });
    expect(byRule['newsMinutes']).toMatchObject({ status: 'not_applicable' });
    expect(ev.rules.map((r) => r.rule)).toEqual(['maxConsecutiveLosses', 'maxTrades', 'maxDailyLoss', 'allowedAssets', 'newsMinutes']);
  });

  it('perte max : le trade qui fait passer le net réalisé sous −X, frais déduits', () => {
    const trades: ContractTrade[] = [
      { id: 'a', asset: 'MNQ', tradedAt: at('14:00'), pnl: -99, commission: 0.5 },
      { id: 'b', asset: 'MNQ', tradedAt: at('14:10'), pnl: -1, commission: 0.6 },
      { id: 'c', asset: 'MNQ', tradedAt: at('14:20'), pnl: 30, commission: 1 },
    ];
    const r = evaluateContract({ ...none, maxDailyLoss: 100 }, trades).rules[0];
    expect(r).toMatchObject({ status: 'breached', breachTradeId: 'b', after: { count: 1, pnl: 29 }, measure: -72.1 });
  });

  it('perte max DU JOUR : la 2ᵉ séance part du cumul de la 1ʳᵉ (pas de remise à zéro)', () => {
    const trades: ContractTrade[] = [
      { id: 'x', asset: 'MNQ', tradedAt: at('16:00'), pnl: -40 },
      { id: 'y', asset: 'MNQ', tradedAt: at('16:10'), pnl: -30 },
    ];
    const r = evaluateContract({ ...none, maxDailyLoss: 300 }, trades, undefined, { dayPnlBefore: -250 }).rules[0];
    expect(r).toMatchObject({ status: 'breached', breachTradeId: 'y', after: { count: 0, pnl: 0 }, measure: -320 });
    // Sans séance précédente : tenue.
    expect(evaluateContract({ ...none, maxDailyLoss: 300 }, trades).rules[0]).toMatchObject({ status: 'respected', measure: -70 });
  });

  it('actifs : un trade hors liste ; liste vide = tous', () => {
    const r = evaluateContract({ ...none, allowedAssets: ['MNQ'] }, SCENARIO).rules[0];
    expect(r).toMatchObject({ status: 'breached', breachTradeId: 't3', measure: 5 });
    expect(evaluateContract(none, SCENARIO).rules).toEqual([]);
  });

  it('annonces : trade dans la fenêtre d’une annonce forte de ses devises', () => {
    const events = [{ at: new Date(at('15:45')), currency: 'USD' }];
    const r = evaluateContract({ ...none, newsMinutes: 5 }, SCENARIO, events).rules[0];
    expect(r).toMatchObject({ status: 'breached', breachTradeId: 't4', measure: 2 });
    expect(evaluateContract({ ...none, newsMinutes: 5 }, SCENARIO, [{ at: new Date(at('18:00')), currency: 'USD' }]).rules[0].status).toBe('respected');
  });

  it('règle en vigueur à l’heure du trade : desserrer après l’infraction ne l’efface pas', () => {
    const contract = { ...none, maxTrades: 6, edits: [{ at: at('16:02'), field: 'maxTrades' as const, from: 5, to: 6 }] };
    expect(ruleAt(contract, 'maxTrades', new Date(at('15:58')))).toBe(5);
    expect(ruleAt(contract, 'maxTrades', new Date(at('16:05')))).toBe(6);
    const r = evaluateContract(contract, SCENARIO).rules[0];
    expect(r).toMatchObject({ status: 'breached', breachTradeId: 't6', limit: 5 });
  });

  it('règle fixée en cours de séance : les trades d’avant ne sont pas jugés', () => {
    const contract = { ...none, maxTrades: 2, edits: [{ at: at('15:55'), field: 'maxTrades' as const, from: null, to: 2 }] };
    const r = evaluateContract(contract, SCENARIO).rules[0];
    expect(r).toMatchObject({ status: 'breached', breachTradeId: 't6' });
  });

  it('trades ouverts ignorés, aucun trade : tout est tenu', () => {
    const ev = evaluateContract({ ...none, maxTrades: 1 }, [{ id: 'o', asset: 'MNQ', tradedAt: at('14:00'), pnl: null }]);
    expect(ev).toMatchObject({ respected: 1, applicable: 1 });
  });
});
