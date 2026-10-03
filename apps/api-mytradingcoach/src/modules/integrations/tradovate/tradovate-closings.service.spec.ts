import { describe, it, expect, vi } from 'vitest';
import {
  CLOSINGS_WINDOW_DAYS,
  TradovateClosingsService,
  parseAccountBalanceHistory,
  parseReportAmount,
} from './tradovate-closings.service';
import { TradovateApiError } from './tradovate.errors';

/**
 * Clôtures officielles (rapport `Account Balance History`). Verrouille : le format réel du CSV
 * (relevé le 2026-10-03), la reprise incrémentale, et l'exclusion de la séance en cours — son
 * « Total Amount » n'est pas encore une clôture.
 */

const HEADER = 'Account ID,Account Name,Trade Date,Total Amount,Total Realized PNL';

describe('parseReportAmount', () => {
  it('guillemets, milliers, négatif entre parenthèses, dollar', () => {
    expect(parseReportAmount('"50,000.00"')).toBe(50_000);
    expect(parseReportAmount('(125.50)')).toBe(-125.5);
    expect(parseReportAmount('$1,234.5')).toBe(1_234.5);
    expect(parseReportAmount('-42.10')).toBe(-42.1);
    expect(parseReportAmount('n/a')).toBeNaN();
    expect(parseReportAmount('')).toBeNaN();
  });
});

describe('parseAccountBalanceHistory', () => {
  it('lignes du compte demandé ; ligne illisible ou autre compte ignorés', () => {
    const csv = [
      HEADER,
      '123,APEX-1,2026-09-30,"50,125.00",125.00',
      '123,APEX-1,2026-10-01,"49,980.50",(144.50)',
      '999,AUTRE,2026-10-01,"10,000.00",0.00',
      '123,APEX-1,pas-une-date,"1.00",0.00',
    ].join('\r\n');
    expect(parseAccountBalanceHistory(csv, 'APEX-1')).toEqual([
      { tradeDate: '2026-09-30', closingBalance: 50_125, realizedPnl: 125 },
      { tradeDate: '2026-10-01', closingBalance: 49_980.5, realizedPnl: -144.5 },
    ]);
  });

  it('colonnes repérées par leur nom, pas par leur position', () => {
    const csv = 'Trade Date,Total Realized PNL,Total Amount\n2026-10-01,10.00,"50,010.00"';
    expect(parseAccountBalanceHistory(csv, 'X')).toEqual([{ tradeDate: '2026-10-01', closingBalance: 50_010, realizedPnl: 10 }]);
  });

  it('rapport vide (en-tête seul) ou sans colonnes attendues → aucune clôture', () => {
    expect(parseAccountBalanceHistory(`${HEADER}\r\n`, 'X')).toEqual([]);
    expect(parseAccountBalanceHistory('Foo,Bar\n1,2', 'X')).toEqual([]);
  });
});

function setup(opts: { last?: string | null; created?: string; csv?: string } = {}) {
  const conn = { id: 'bc-1', accountId: 'acc-1', externalAccountId: '123', externalEnv: 'demo' };
  const prisma = {
    brokerDailyClose: {
      findFirst: vi.fn(async () => (opts.last ? { tradeDate: new Date(`${opts.last}T00:00:00Z`) } : null)),
      upsert: vi.fn(async () => ({})),
    },
  };
  const api = { get: vi.fn(async () => [{ id: 123, name: 'APEX-1', timestamp: opts.created ?? '2026-09-01T10:00:00Z' }]) };
  const reporting = { fetchCsv: vi.fn(async () => opts.csv ?? `${HEADER}\r\n`) };
  const service = new TradovateClosingsService(prisma as never, api as never, reporting as never);
  return { service, prisma, api, reporting, conn };
}

describe('TradovateClosingsService.refresh', () => {
  // Vendredi 2 octobre 2026, 15:00 UTC = 10:00 heure de Chicago : séance du 2 octobre en cours.
  const now = new Date('2026-10-02T15:00:00Z');

  it('séance en cours jamais stockée ; séances closes enregistrées (upsert idempotent)', async () => {
    const csv = [HEADER, '123,APEX-1,2026-10-01,"50,100.00",100.00', '123,APEX-1,2026-10-02,"50,300.00",200.00'].join('\r\n');
    const { service, prisma, conn } = setup({ last: '2026-09-30', csv });
    expect(await service.refresh(conn as never, 'AT', null, now)).toBe(1);
    expect(prisma.brokerDailyClose.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.brokerDailyClose.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId_tradeDate: { accountId: 'acc-1', tradeDate: new Date('2026-10-01T00:00:00Z') } },
      create: expect.objectContaining({ closingBalance: 50_100, realizedPnl: 100 }),
    }));
  });

  it('incrémental : reprend à la dernière séance stockée, filtrée par NOM de compte', async () => {
    const { service, reporting, conn } = setup({ last: '2026-09-30' });
    await service.refresh(conn as never, 'AT', { reportingDemo: 'rpt.example' }, now);
    expect(reporting.fetchCsv).toHaveBeenCalledTimes(1);
    const [, , name, window, hosts] = reporting.fetchCsv.mock.calls[0] as unknown as [string, string, string, { from: Date; to: Date; accountName: string }, unknown];
    expect(name).toBe('Account Balance History');
    expect(window.from.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(window.accountName).toBe('APEX-1');
    expect(hosts).toEqual({ reportingDemo: 'rpt.example' });
  });

  it('premier passage : depuis la création du compte, en fenêtres de 60 jours au plus', async () => {
    const { service, reporting, conn } = setup({ last: null, created: '2026-05-01T09:00:00Z' });
    await service.refresh(conn as never, 'AT', null, now);
    const windows = reporting.fetchCsv.mock.calls.map((c) => (c as unknown as [unknown, unknown, unknown, { from: Date; to: Date }])[3]);
    expect(windows[0].from.toISOString().slice(0, 10)).toBe('2026-05-01');
    for (const w of windows) expect((w.to.getTime() - w.from.getTime()) / 86_400_000).toBeLessThan(CLOSINGS_WINDOW_DAYS);
    expect(windows.at(-1)!.to.getTime()).toBe(now.getTime());
  });

  it('fenêtre en échec : les autres continuent ; jeton refusé : remonte', async () => {
    const { service, reporting, conn } = setup({ last: null, created: '2026-05-01T09:00:00Z' });
    reporting.fetchCsv.mockRejectedValueOnce(new TradovateApiError('unavailable', 500, 'x'));
    await expect(service.refresh(conn as never, 'AT', null, now)).resolves.toBe(0);
    expect(reporting.fetchCsv.mock.calls.length).toBeGreaterThan(1);
    reporting.fetchCsv.mockRejectedValueOnce(new TradovateApiError('unauthorized', 401, 'x'));
    await expect(service.refresh(conn as never, 'AT', null, now)).rejects.toBeInstanceOf(TradovateApiError);
  });

  it('compte absent du login : rien demandé au reporting', async () => {
    const { service, api, reporting, conn } = setup();
    api.get.mockResolvedValueOnce([]);
    expect(await service.refresh(conn as never, 'AT', null, now)).toBe(0);
    expect(reporting.fetchCsv).not.toHaveBeenCalled();
  });
});
