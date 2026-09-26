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

/**
 * Les frais viennent du rapport `Fills` : il porte le `Fill ID` ET sa `commission`, donc la
 * jointure est exacte. Le `Cash History` de l'import CSV manuel relie la commission au fill par
 * `txnId − 1`, convention qui NE TIENT PAS sur les comptes testés (0/291 le 2026-09-26).
 */
const FILLS_CSV = [
  '_id,_orderId,Fill ID,Order ID,Timestamp,Account,B/S,Quantity,Price,Contract,Product,commission',
  '671418950023,671418950004,671418950023,671418950004,09/23/2026 13:34:57,APEX,Buy,2,30928.50,MNQZ6,MNQ,1.04',
  '671418950030,671418950027,671418950030,671418950027,09/23/2026 13:35:05,APEX,Sell,2,30934.00,MNQZ6,MNQ,1.04',
  '671418950045,671418950040,671418950045,671418950040,09/23/2026 13:36:07,APEX,Buy,2,30924.75,MNQZ6,MNQ,1.04',
  '671418950051,671418950048,671418950051,671418950048,09/23/2026 13:36:12,APEX,Sell,2,30932.25,MNQZ6,MNQ,1.04',
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
  const setups = { getImportSetupId: vi.fn().mockResolvedValue('setup-import') };
  const persiste: Record<string, unknown>[][] = [];
  const trades = {
    importTrades: vi.fn().mockImplementation((_u: string, dtos: Record<string, unknown>[]) => {
      persiste.push(dtos);
      return Promise.resolve({ created: dtos.length, duplicates: 0, failed: 0, total: dtos.length });
    }),
  };
  const prisma = { brokerConnection: { update: vi.fn().mockResolvedValue({}) } };
  const service = new TradovateHistoryService(
    prisma as never, api as never, connections as never, reporting as never, setups as never, trades as never,
  );
  vi.spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait').mockResolvedValue(undefined);
  return { service, prisma, api, connections, reporting, setups, trades, persiste };
}

describe('TradovateHistoryService — import de l’historique', () => {
  it('importe une fenêtre : trades mappés, frais joints par fill, défauts posés', async () => {
    const { service, trades, persiste } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });

    const r = await service.importHistory('u1', conn(), { months: 1 });

    expect(r.created).toBe(2);
    // La provenance est posée : ces trades viennent de l'historique broker, pas d'un CSV.
    expect(trades.importTrades).toHaveBeenCalledWith('u1', expect.any(Array), 'BROKER_HISTORY');
    const [gagnant, perdant] = persiste[0];
    expect(gagnant.asset).toBe('MNQ');
    expect(gagnant.pnl).toBe(22);
    expect(perdant.pnl).toBe(-30); // `$(30.00)` = négatif
    // 2 fills × 1,04 par trade, attribués une seule fois chacun.
    expect(gagnant.commission).toBe(2.08);
    expect(r.feesAssigned).toBe(4.16);
    expect(r.feesExpected).toBe(4.16);
    expect(gagnant.accountId).toBe('compte-mtc-1');
    expect(gagnant.setupId).toBe('setup-import');
    // Métadonnées de rapprochement : jamais persistées.
    expect(gagnant).not.toHaveProperty('_buyFillId');
  });

  it('la provenance distingue historique et synchro live', async () => {
    // Deux chemins, deux sources : un écart de frais ou de P&L ne se lit pas pareil selon
    // qu'il vient de la séance (Trade API) ou d'un rapport mensuel (Reporting API).
    const { service, trades } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });
    await service.importHistory('u1', conn(), { months: 1 });
    expect(trades.importTrades.mock.calls[0][2]).toBe('BROKER_HISTORY');
  });

  it('incrémente le compteur de la connexion : 294 trades importés ≠ « 0 trade importé »', async () => {
    const { service, prisma } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });
    await service.importHistory('u1', conn(), { months: 1 });
    expect(prisma.brokerConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { tradesImported: { increment: 2 } },
    });
  });

  it('aucun trade créé → aucune écriture du compteur', async () => {
    const { service, prisma } = setup({ Performance: '' });
    await service.importHistory('u1', conn(), { months: 1 });
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
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
    expect(reporting.fetchCsv).toHaveBeenCalledTimes(2); // pas de rapport Fills sur un mois vide
  });

  it('frais indisponibles → import quand même, en P&L brut', async () => {
    const { service, persiste } = setup({
      Performance: PERFORMANCE_CSV,
      Fills: new TradovateApiError('unavailable', 500, 'Fills'),
    });

    const r = await service.importHistory('u1', conn(), { months: 1 });

    expect(r.created).toBe(2);
    expect(r.feesAssigned).toBe(0);
    expect(persiste[0][0].commission).toBeUndefined();
  });

  it('une fenêtre en échec n’annule pas les autres mois', async () => {
    const { service, reporting } = setup();
    let appel = 0;
    reporting.fetchCsv.mockImplementation((_e: string, _t: string, name: string) => {
      if (name === 'Fills') return Promise.resolve(FILLS_CSV);
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
    const { service, trades } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });
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
