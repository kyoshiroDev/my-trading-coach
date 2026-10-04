import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TradovatePayoutsService, normalizeChangeType, payoutConfidence, scanCashHistory } from './tradovate-payouts.service';
import { TradovateApiError } from './tradovate.errors';

/**
 * Détection des payouts dans le rapport `Cash History`. Verrouille : le format réel (libellés
 * « Trade Paired » avec espaces), la règle « retrait certain » (ChallengePayout, FundTransaction
 * négatif — jamais ManualAdjustment ni Debit), et le curseur qui n'avance que sans trou.
 */

const HEADER = 'Account,Transaction ID,Timestamp,Date,Delta,Amount,Cash Change Type,Currency,Contract';

describe('normalizeChangeType / payoutConfidence', () => {
  it('libellés du rapport → type normalisé', () => {
    expect(normalizeChangeType(' Trade Paired')).toBe('tradepaired');
    expect(normalizeChangeType('Challenge Payout')).toBe('challengepayout');
    expect(normalizeChangeType('FundTransaction')).toBe('fundtransaction');
  });

  it('certain : ChallengePayout (tout signe), FundTransaction négatif', () => {
    expect(payoutConfidence('challengepayout', -1_500, false)).toBe('certain');
    expect(payoutConfidence('challengepayout', 1_500, false)).toBe('certain'); // signe écrit par la firme : le type suffit
    expect(payoutConfidence('fundtransaction', -2_000, false)).toBe('certain');
    expect(payoutConfidence('fundtransaction', 2_000, true)).toBeNull(); // dépôt
  });

  it('ajustement manuel négatif ≥ 100 $ sur un compte funded (Apex) : payout, jamais en évaluation', () => {
    expect(payoutConfidence('manualadjustment', -1_085, true)).toBe('certain');
    expect(payoutConfidence('manualadjustment', -1_085, false)).toBeNull(); // évaluation : reset, correction
    expect(payoutConfidence('manualadjustment', -99, true)).toBeNull(); // frais, correction
    expect(payoutConfidence('manualadjustment', 3_500, true)).toBeNull(); // crédit
    expect(payoutConfidence('debit', -2_000, true)).toBeNull();
    expect(payoutConfidence('commission', -1.04, true)).toBeNull();
  });
});

describe('scanCashHistory', () => {
  it('export réel (commissions, trades) : aucun payout, types comptés', () => {
    const csv = readFileSync(join(__dirname, '../../trades/__fixtures__/tradovate-cash-history.csv'), 'utf8');
    const scan = scanCashHistory(csv, 'APEX136790000074');
    expect(scan.payouts).toEqual([]);
    expect(scan.typeCounts).toEqual({ commission: 37, tradepaired: 20 });
  });

  it('payout et retrait détectés ; dépôt, ajustement et autre compte ignorés', () => {
    const csv = [
      HEADER,
      'APEX-1,900001,10/02/2026 19:30:00,2026-10-02,"(1,500.00)","51,000.00",Challenge Payout,USD,',
      'APEX-1,900002,10/03/2026 14:00:00,2026-10-03,"-2,000.00","49,000.00",Fund Transaction,USD,',
      'APEX-1,900003,10/03/2026 15:00:00,2026-10-03,"2,000.00","51,000.00",Fund Transaction,USD,',
      'APEX-1,900004,10/03/2026 16:00:00,2026-10-03,"-3,000.00","48,000.00",Manual Adjustment,USD,',
      'AUTRE,900005,10/03/2026 16:00:00,2026-10-03,"-9.00","1.00",Challenge Payout,USD,',
    ].join('\r\n');
    expect(scanCashHistory(csv, 'APEX-1').payouts).toEqual([
      { transactionId: '900001', tradeDate: '2026-10-02', amount: 1_500, changeType: 'challengepayout', confidence: 'certain' },
      { transactionId: '900002', tradeDate: '2026-10-03', amount: 2_000, changeType: 'fundtransaction', confidence: 'certain' },
    ]);
  });

  it('compte funded : l\'ajustement manuel négatif est un payout', () => {
    const csv = [HEADER, 'APEX-1,900004,10/01/2026 16:00:00,2026-10-01,"-1,085.00","48,000.00",Manual Adjustment,USD,'].join('\r\n');
    expect(scanCashHistory(csv, 'APEX-1', true).payouts).toEqual([
      { transactionId: '900004', tradeDate: '2026-10-01', amount: 1_085, changeType: 'manualadjustment', confidence: 'certain' },
    ]);
    expect(scanCashHistory(csv, 'APEX-1', false).payouts).toEqual([]);
  });

  it('sans colonne Date : journée de trading tirée de l\'horodatage (UTC)', () => {
    const csv = 'Transaction ID,Timestamp,Delta,Cash Change Type\n1,10/02/2026 23:30:00,-100,Challenge Payout';
    expect(scanCashHistory(csv, 'X').payouts[0].tradeDate).toBe('2026-10-03'); // 18:30 CT → séance du 3
  });
});

function setup(opts: { checked?: string | null; csv?: string } = {}) {
  const conn = { id: 'bc-1', accountId: 'acc-1', externalAccountId: '7', externalEnv: 'demo',
    payoutsCheckedThrough: opts.checked ? new Date(`${opts.checked}T00:00:00Z`) : null };
  const prisma = {
    brokerPayout: { createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })) },
    tradingAccount: { findUnique: vi.fn(async () => ({ type: 'FUNDED' })) },
    brokerConnection: { update: vi.fn(async () => ({})) },
  };
  const api = { get: vi.fn(async () => [{ id: 7, name: 'APEX-1', timestamp: '2026-05-01T00:00:00Z' }]) };
  const reporting = { fetchCsv: vi.fn(async () => opts.csv ?? `${HEADER}\r\n`) };
  return { service: new TradovatePayoutsService(prisma as never, api as never, reporting as never), prisma, reporting, conn };
}

describe('TradovatePayoutsService.refresh', () => {
  const now = new Date('2026-10-03T15:00:00Z');

  it('curseur : repart de la dernière séance couverte, puis avance', async () => {
    const { service, reporting, prisma, conn } = setup({ checked: '2026-09-30' });
    await service.refresh(conn as never, 'AT', null, now);
    expect(reporting.fetchCsv).toHaveBeenCalledTimes(1);
    const w = (reporting.fetchCsv.mock.calls[0] as unknown as [unknown, unknown, string, { from: Date; accountName: string }])[3];
    expect(w.from.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(w.accountName).toBe('APEX-1');
    expect(prisma.brokerConnection.update).toHaveBeenCalledWith({
      where: { id: 'bc-1' }, data: { payoutsCheckedThrough: new Date('2026-10-03T00:00:00Z') },
    });
  });

  it('payout enregistré une seule fois (doublon ignoré par la contrainte)', async () => {
    const csv = `${HEADER}\r\nAPEX-1,900001,10/02/2026 19:30:00,2026-10-02,"-1,500.00","51,000.00",Challenge Payout,USD,`;
    const { service, prisma, conn } = setup({ checked: '2026-09-30', csv });
    expect(await service.refresh(conn as never, 'AT', null, now)).toBe(1);
    expect(prisma.brokerPayout.createMany).toHaveBeenCalledWith({
      data: [{ accountId: 'acc-1', transactionId: '900001', tradeDate: new Date('2026-10-02T00:00:00Z'), amount: 1_500, changeType: 'challengepayout', confidence: 'certain' }],
      skipDuplicates: true,
    });
  });

  it('une fenêtre en échec : le curseur n\'avance pas (pas de trou définitif) ; jeton refusé : remonte', async () => {
    const { service, reporting, prisma, conn } = setup({ checked: null });
    reporting.fetchCsv.mockRejectedValueOnce(new TradovateApiError('unavailable', 500, 'x'));
    await service.refresh(conn as never, 'AT', null, now);
    expect(reporting.fetchCsv.mock.calls.length).toBeGreaterThan(1); // depuis la création, plusieurs fenêtres
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
    reporting.fetchCsv.mockRejectedValueOnce(new TradovateApiError('unauthorized', 401, 'x'));
    await expect(service.refresh(conn as never, 'AT', null, now)).rejects.toBeInstanceOf(TradovateApiError);
  });
});
