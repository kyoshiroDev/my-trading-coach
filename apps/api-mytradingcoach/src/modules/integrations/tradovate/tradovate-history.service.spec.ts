import { BrokerConnection, BrokerConnectionStatus, BrokerProvider } from '@prisma/client';
import { HISTORY_MAX_MONTHS, TradovateHistoryService } from './tradovate-history.service';
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
    // Par défaut : connexion dont l'historique complet a DÉJÀ été importé, donc une profondeur
    // demandée est respectée. Le cas contraire (`null`) remonte toute la vie du compte.
    historyImportedAt: new Date('2026-09-01T00:00:00Z'),
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

  it('les horodatages du rapport sont lus en UTC, pas en heure du serveur', async () => {
    // Bug trouvé en prod : 294 trades importés avec 2 h d'avance. Le rapport est demandé en
    // `timezone: 0`, mais `new Date("09/23/2026 13:34:57")` sans fuseau est lu en heure LOCALE
    // (conteneur en Europe/Paris) — d'où le décalage. Ce test échoue si la conversion saute.
    const { service, persiste } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });

    await service.importHistory('u1', conn(), { months: 1 });

    // Le CSV dit « 09/23/2026 13:35:05 » pour la vente : c'est de l'UTC, donc 13:35:05Z.
    expect(new Date(persiste[0][0].tradedAt as string).toISOString()).toBe('2026-09-23T13:35:05.000Z');
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
 * Profondeur de l'import : toute la vie du compte, jusqu'à sa création.
 *
 * Tradovate date le compte (`timestamp` sur `/account/list`) : c'est la borne basse, et elle
 * remplace la profondeur devinée de 6 mois. Le cas qui a motivé le changement est vérifié en vrai :
 * compte créé le 2026-02-12, premier trade en juillet — cinq mois vides entre les deux, que
 * l'ancien arrêt « deux mois vides d'affilée » rendait définitivement inatteignables.
 */
describe('TradovateHistoryService — profondeur de l’import', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-26T12:00:00Z') }));
  afterEach(() => vi.useRealTimers());

  /** Ce que `/account/list` renvoie réellement, `timestamp` compris (relevé le 2026-09-26). */
  const compte = (timestamp?: string) => [
    { id: 66880224, name: 'APEX4280470000012', userId: 699523, timestamp },
  ];

  const moisDemandes = (reporting: { fetchCsv: { mock: { calls: unknown[][] } } }) =>
    reporting.fetchCsv.mock.calls
      .filter((c) => c[2] === 'Performance')
      .map((c) => toReportDate((c[3] as { from: Date }).from));

  it('sans profondeur demandée → remonte jusqu’au mois de création, celui-ci inclus', async () => {
    const { service, api, reporting } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte('2026-02-12T14:11:13Z'));

    const r = await service.importHistory('u1', conn());

    // Février → septembre = 8 fenêtres, tirées malgré 8 mois vides d'affilée.
    const mois = moisDemandes(reporting);
    expect(mois).toHaveLength(8);
    expect(mois[0]).toBe('9/1/2026');
    expect(mois.at(-1)).toBe('2/1/2026');
    expect(r.windows).toBe(8);
  });

  it('cinq mois vides entre la création et le premier trade ne tronquent pas l’historique', async () => {
    const { service, api, reporting } = setup();
    api.get.mockResolvedValue(compte('2026-02-12T14:11:13Z'));
    reporting.fetchCsv.mockImplementation(
      (_e: string, _t: string, name: string, w: { from: Date }) =>
        Promise.resolve(
          name === 'Fills' ? FILLS_CSV : w.from.getUTCMonth() === 6 ? PERFORMANCE_CSV : '',
        ),
    );

    const r = await service.importHistory('u1', conn());

    expect(r.windows).toBe(8);
    expect(r.created).toBe(2); // juillet atteint, cinq mois vides plus tôt
  });

  it('compte non daté par Tradovate → repli 6 mois, et l’arrêt aux mois vides reprend son rôle', async () => {
    // Sans borne basse, la fin apparente de l'historique est la seule information disponible.
    const { service, api } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte(undefined));

    expect((await service.importHistory('u1', conn())).windows).toBe(2);
  });

  it('date de création dans le futur → donnée non crue, repli sur le comportement prudent', async () => {
    const { service, api } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte('2027-01-01T00:00:00Z'));

    expect((await service.importHistory('u1', conn())).windows).toBe(2);
  });

  it('compte très ancien → borné par le garde-fou, jamais de boucle sans fin', async () => {
    const { service, api } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });
    api.get.mockResolvedValue(compte('2015-01-01T00:00:00Z'));

    expect((await service.importHistory('u1', conn())).windows).toBe(HISTORY_MAX_MONTHS);
  });

  it('profondeur explicite (rattrapage horaire du cron) → un seul mois, la création est ignorée', async () => {
    const { service, api } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte('2015-01-01T00:00:00Z'));

    expect((await service.importHistory('u1', conn(), { months: 1 })).windows).toBe(1);
  });

  /**
   * La profondeur demandée est un contrat, jamais « corrigée » pour bien faire. L'appelant qui ne
   * demande qu'un mois, c'est le plus souvent le bouton « Synchroniser » : quelqu'un attend devant
   * son écran. Remonter deux ans à sa place ferait d'un clic de 2 s un clic de 30 s. Le rattrapage
   * du passé complet appartient au cron (cf. `tradovate-background-refresh.cron`).
   */
  it('connexion jamais importée + un seul mois demandé → un seul mois, personne n’attend 24 fenêtres', async () => {
    const { service, api } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte('2024-01-01T00:00:00Z')); // compte de presque 3 ans

    const r = await service.importHistory('u1', conn({ historyImportedAt: null }), { months: 1 });

    expect(r.windows).toBe(1);
  });

  it('import complet réussi → marqueur posé, les synchros suivantes s’en tiennent au mois demandé', async () => {
    const { service, api, prisma } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte('2026-08-01T00:00:00Z'));

    await service.importHistory('u1', conn({ historyImportedAt: null }));

    expect(prisma.brokerConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { historyImportedAt: new Date('2026-09-26T12:00:00Z') },
    });
  });

  it('une fenêtre en échec → marqueur laissé vide, le passé manquant sera retenté', async () => {
    // Poser le marqueur ici condamnerait le mois perdu : plus aucune synchro ne le redemanderait.
    const { service, api, reporting, prisma } = setup();
    api.get.mockResolvedValue(compte('2026-08-01T00:00:00Z'));
    reporting.fetchCsv.mockRejectedValue(new TradovateApiError('unavailable', 500, 'Performance'));

    const r = await service.importHistory('u1', conn({ historyImportedAt: null }));

    expect(r.failed).toBeGreaterThan(0);
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
  });

  it('un mois demandé ne pose jamais le marqueur : le passé n’a pas été remonté', async () => {
    // Poser le marqueur ici condamnerait tout le passé du compte : plus aucun rattrapage n'y
    // toucherait, alors qu'un seul mois a été lu.
    const { service, api, prisma } = setup({ Performance: PERFORMANCE_CSV, Fills: FILLS_CSV });
    api.get.mockResolvedValue(compte('2026-02-12T14:11:13Z'));

    await service.importHistory('u1', conn({ historyImportedAt: null }), { months: 1 });

    expect(prisma.brokerConnection.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { tradesImported: { increment: 2 } }, // et RIEN d'autre
    });
  });

  it('marqueur déjà posé → aucune réécriture, et le mois demandé est respecté', async () => {
    const { service, api, prisma } = setup({ Performance: '' });
    api.get.mockResolvedValue(compte('2026-02-12T14:11:13Z'));

    const r = await service.importHistory('u1', conn(), { months: 1 });

    expect(r.windows).toBe(1);
    expect(prisma.brokerConnection.update).not.toHaveBeenCalled();
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
