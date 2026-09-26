import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { TradovateHistoryService } from './tradovate-history.service';
import { TradovateApiError } from './tradovate.errors';
import { toReportDate } from './tradovate-reporting.client';
import { preprocessCsv, mapNormalizedCsvToDto } from '../../trades/csv-parsers';

/**
 * Import de l'historique par la Reporting API (PROMPT-217).
 *
 * Les CSV ci-dessous sont des extraits RÉELS, relevés le 2026-09-26 sur le compte prop firm
 * d'un ambassadeur : c'est ce que l'API renvoie, virgules et P&L comptable compris.
 */
const PERFORMANCE_CSV = [
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
  'MNQZ6,-2,0,0.25,671418950023,671418950030,2,30928.50,30934.00,$22.00,09/23/2026 13:34:57,09/23/2026 13:35:05,7sec',
  'MNQZ6,-2,0,0.25,671418950045,671418950051,2,30924.75,30932.25,$(30.00),09/23/2026 13:36:07,09/23/2026 13:36:12,4sec',
].join('\n');

const CASH_CSV = [
  'Account,Transaction ID,Timestamp,Date,Delta,Amount,Cash Change Type,Currency,Contract',
  'APEX4280470000012,671418950024,09/23/2026 13:34:57,2026-09-23,-1.04,"49,998.96", Commission,USD,MNQZ6',
].join('\n');

function conn(overrides: Partial<BrokerConnection> = {}): BrokerConnection {
  return {
    id: 'c1',
    userId: 'u1',
    accountId: 'compte-mtc-1',
    provider: BrokerProvider.TRADOVATE,
    status: BrokerConnectionStatus.CONNECTED,
    externalAccountId: '66880224',
    externalAccountName: 'NOM-PERIME',
    externalEnv: 'demo',
    ...overrides,
  } as BrokerConnection;
}

function setup(csvByReport: Record<string, string | Error> = {}) {
  const api = {
    // Le nom est RELU ici : celui stocké peut être périmé.
    get: vi.fn().mockResolvedValue([{ id: 66880224, name: 'APEX4280470000012', userId: 699523 }]),
  };
  const connections = {
    getAccessToken: vi.fn().mockResolvedValue('AT-1'),
    getConnection: vi.fn().mockResolvedValue(conn()),
  };
  const reporting = {
    fetchCsv: vi.fn().mockImplementation((_env: string, _t: string, name: string) => {
      const v = csvByReport[name];
      if (v instanceof Error) return Promise.reject(v);
      return Promise.resolve(v ?? '');
    }),
  };
  const csvImport = {
    parseCSV: vi.fn().mockResolvedValue([{ asset: 'MNQ', side: 'LONG' }, { asset: 'MNQ', side: 'SHORT' }]),
  };
  const trades = {
    importTrades: vi.fn().mockResolvedValue({ created: 2, duplicates: 0, failed: 0, total: 2 }),
  };
  const service = new TradovateHistoryService(
    api as never, connections as never, reporting as never, csvImport as never, trades as never,
  );
  vi.spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait').mockResolvedValue(undefined);
  return { service, api, connections, reporting, csvImport, trades };
}

describe('TradovateHistoryService — import de l’historique', () => {
  it('importe une fenêtre : Performance + frais passent par le chemin CSV existant', async () => {
    const { service, reporting, csvImport, trades } = setup({
      Performance: PERFORMANCE_CSV,
      'Cash History': CASH_CSV,
    });

    const r = await service.importHistory('u1', conn(), { months: 1 });

    expect(r.created).toBe(2);
    expect(trades.importTrades).toHaveBeenCalledWith('u1', expect.any(Array));
    // Le CSV de l'API est donné TEL QUEL au parseur d'import : aucun format intermédiaire.
    const [buffer, filename, userId, , , defaults, feesFile] = csvImport.parseCSV.mock.calls[0];
    expect(buffer.toString()).toBe(PERFORMANCE_CSV);
    expect(filename).toContain('tradovate');
    expect(userId).toBe('u1');
    expect(defaults).toEqual({ accountId: 'compte-mtc-1' });
    expect(feesFile.buffer.toString()).toBe(CASH_CSV);
    expect(reporting.fetchCsv).toHaveBeenCalledTimes(2);
  });

  it('interroge Tradovate avec le nom RELU du compte, pas celui stocké en base', async () => {
    const { service, reporting } = setup({ Performance: PERFORMANCE_CSV });

    await service.importHistory('u1', conn({ externalAccountName: 'NOM-PERIME' }), { months: 1 });

    const [, , , window] = reporting.fetchCsv.mock.calls[0];
    expect(window.accountName).toBe('APEX4280470000012');
  });

  it('les fenêtres sont mensuelles et remontent dans le temps', async () => {
    const { service, reporting } = setup({ Performance: PERFORMANCE_CSV });

    await service.importHistory('u1', conn(), { months: 3 });

    const fenetres = reporting.fetchCsv.mock.calls
      .filter((c) => c[2] === 'Performance')
      .map((c) => `${toReportDate(c[3].from)}→${toReportDate(c[3].to)}`);
    expect(fenetres).toHaveLength(3);
    // Chaque fenêtre commence le 1er du mois, et la plus récente ne dépasse pas aujourd'hui.
    reporting.fetchCsv.mock.calls.forEach(([, , , w]) => {
      expect(w.from.getUTCDate()).toBe(1);
      expect(w.to.getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  it('s’arrête après deux mois vides d’affilée au lieu de tirer tous les rapports', async () => {
    const { service, reporting } = setup({ Performance: '' }); // aucun trade nulle part

    const r = await service.importHistory('u1', conn(), { months: 6 });

    expect(r.windows).toBe(2);
    expect(r.empty).toBe(2);
    expect(reporting.fetchCsv).toHaveBeenCalledTimes(2); // pas de Cash History sur un mois vide
  });

  it('frais indisponibles → import quand même, en P&L brut', async () => {
    const { service, csvImport } = setup({
      Performance: PERFORMANCE_CSV,
      'Cash History': new TradovateApiError('unavailable', 500, 'Cash History'),
    });

    const r = await service.importHistory('u1', conn(), { months: 1 });

    expect(r.created).toBe(2);
    expect(csvImport.parseCSV.mock.calls[0][6]).toBeUndefined(); // aucun fichier de frais
  });

  it('une fenêtre en échec n’annule pas les autres mois', async () => {
    const { service, reporting } = setup();
    let appel = 0;
    reporting.fetchCsv.mockImplementation((_e: string, _t: string, name: string) => {
      if (name === 'Cash History') return Promise.resolve(CASH_CSV);
      appel++;
      if (appel === 1) return Promise.reject(new TradovateApiError('unavailable', 500, 'Performance'));
      return Promise.resolve(PERFORMANCE_CSV);
    });

    const r = await service.importHistory('u1', conn(), { months: 3 });

    expect(r.failed).toBe(1);
    expect(r.created).toBeGreaterThan(0);
  });

  it('jeton mort → on arrête tout de suite, sans marteler Tradovate', async () => {
    const { service, reporting } = setup();
    reporting.fetchCsv.mockRejectedValue(new TradovateApiError('unauthorized', 401, 'Performance'));

    await expect(service.importHistory('u1', conn(), { months: 6 })).rejects.toMatchObject({
      code: 'TRADOVATE_RECONNECT_REQUIRED',
    });
    expect(reporting.fetchCsv).toHaveBeenCalledTimes(1);
  });

  it('compte non choisi → refus explicite, aucun appel réseau', async () => {
    const { service, reporting } = setup();
    await expect(
      service.importHistory('u1', conn({ externalAccountId: null }), { months: 1 }),
    ).rejects.toMatchObject({ code: 'TRADOVATE_ACCOUNT_SELECTION_REQUIRED' });
    expect(reporting.fetchCsv).not.toHaveBeenCalled();
  });

  it('rejouable : la dédup d’importTrades fait que rien n’est recréé', async () => {
    const { service, trades } = setup({ Performance: PERFORMANCE_CSV, 'Cash History': CASH_CSV });
    trades.importTrades.mockResolvedValue({ created: 0, duplicates: 2, failed: 0, total: 2 });

    const r = await service.importHistory('u1', conn(), { months: 1 });

    expect(r.created).toBe(0);
    expect(r.duplicates).toBe(2);
  });
});

/**
 * La promesse qui fonde tout l'import : le CSV de la Reporting API est byte-compatible avec
 * l'export « Performance » que l'app sait déjà lire. Ce test le vérifie sur le VRAI parseur,
 * sans le moindre code d'adaptation — si Tradovate change ses colonnes, il tombe ici.
 */
describe('CSV de la Reporting API ↔ parseur d’import existant', () => {
  it('le CSV renvoyé par l’API est reconnu « tradovate » et donne des trades exploitables', () => {
    const { broker, csv } = preprocessCsv(PERFORMANCE_CSV);
    expect(broker).toBe('tradovate');

    const dtos = mapNormalizedCsvToDto(csv);
    expect(dtos).toHaveLength(2);

    const [gagnant, perdant] = dtos;
    expect(gagnant.asset).toBe('MNQ'); // MNQZ6 → MNQ
    expect(gagnant.entry).toBe(30928.5);
    expect(gagnant.exit).toBe(30934);
    expect(gagnant.quantity).toBe(2);
    expect(gagnant.pnl).toBe(22);
    expect(gagnant.tradedAt).toBeDefined();

    // Le piège du P&L comptable : `$(30.00)` vaut MOINS trente, pas plus.
    expect(perdant.pnl).toBe(-30);
  });
});
