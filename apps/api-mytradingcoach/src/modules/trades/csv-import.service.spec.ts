import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Plan, Role } from '@prisma/client';
import * as XLSX from 'xlsx';
import { CsvImportService, type FeesReport } from './csv-import.service';

// Anthropic SDK lit la clé à la construction → fournir une valeur factice en test
process.env['ANTHROPIC_API_KEY'] = 'test-key';

// Le chemin IA est réservé Premium + prod : pour exercer ce chemin en test,
// il faut un accès Premium ET NODE_ENV=production (helper withAiEnabled ci-dessous).
const PREMIUM_ACCESS = { plan: Plan.PREMIUM, role: Role.USER, trialEndsAt: null };

// Ordre RÉEL de l'export MEXC (CSV et XLSX) : Futures en 1er, UID en dernier,
// nombres au format US avec séparateur de milliers (`73,602.51`).
const MEXC_HEADER =
  'Futures;Open Time;Close Time;Margin Mode;Avg Entry Price;Avg Close Price;Direction;Closing Qty (Cont.);Trading Fee;Realized PNL;Status;UID';

const MEXC_ROW =
  'BTCUSDT;2026-05-30 12:11:40;2026-05-30 14:31:55;Isolated;73,602.51;73,692.56;Short;550;1.6202459USDT;-6.5727459USDT;All Closed;65370223';

function makeService() {
  // Client Anthropic central mocké (le service appelle `anthropicClient.create`).
  const anthropicClient = { create: vi.fn() } as any;
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } } as any;
  // SetupsService : setup par défaut du user (fallback import).
  const setups = { getDefaultSetupId: vi.fn().mockResolvedValue('setup-default') } as any;
  return new CsvImportService(anthropicClient, prisma, setups);
}

describe('CsvImportService — MEXC (parser dédié, sans IA)', () => {
  let svc: CsvImportService;
  beforeEach(() => {
    svc = makeService();
  });

  it("détecte l'en-tête MEXC", () => {
    expect((svc as any).detectBroker(MEXC_HEADER)).toBe('mexc');
  });

  it('parse un fichier MEXC réel (CRLF) sans IA', async () => {
    const csv = [MEXC_HEADER, MEXC_ROW].join('\r\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'mexc.csv');

    expect(dtos).toHaveLength(1);
    const t = dtos[0];
    expect(t.asset).toBe('BTC/USDT');
    expect(t.side).toBe('SHORT');
    expect(t.entry).toBe(73602.51);
    expect(t.exit).toBe(73692.56);
    expect(t.quantity).toBe(550);
    expect(t.pnl).toBeCloseTo(-6.5727459, 5); // PnL net déjà calculé, pas recalculé
    expect(t.commission).toBeCloseTo(1.6202459, 5); // suffixe USDT retiré
    expect(t.tradedAt).toBe('2026-05-30T14:31:55+02:00'); // Close Time UTC+02:00
  });

  it("ne laisse aucun \\r résiduel dans les valeurs (CRLF Windows)", async () => {
    const csv = [MEXC_HEADER, MEXC_ROW].join('\r\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'mexc.csv');
    expect(dtos[0].asset).not.toContain('\r');
    expect(dtos[0].tradedAt).not.toContain('\r');
  });

  it('Long → LONG, Short → SHORT', async () => {
    const longRow = MEXC_ROW.replace(';Short;', ';Long;');
    const csv = [MEXC_HEADER, longRow, MEXC_ROW].join('\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'mexc.csv');
    expect(dtos.map((d) => d.side).sort()).toEqual(['LONG', 'SHORT']);
  });

  it('normalise BTCUSDT → BTC/USDT et laisse les exotiques intacts', () => {
    expect((svc as any).normalizeMexcSymbol('BTCUSDT')).toBe('BTC/USDT');
    expect((svc as any).normalizeMexcSymbol('ETHUSDT')).toBe('ETH/USDT');
    expect((svc as any).normalizeMexcSymbol('GOLD(XAUT)USDT')).toBe('GOLD(XAUT)USDT');
    expect((svc as any).normalizeMexcSymbol('NAS100USDT')).toBe('NAS100/USDT');
  });

  it('ignore les lignes dont le Status ≠ closed', () => {
    const openRow = MEXC_ROW.replace(';All Closed', ';Open');
    const csv = (svc as any).parseMexc([MEXC_HEADER, openRow, MEXC_ROW]) as string;
    const lines = csv.split('\n').filter((l: string) => l.trim());
    expect(lines).toHaveLength(2); // header + 1 trade fermé seulement
  });

  it("parse correctement même avec l'UID en dernière colonne (régression PROMPT-087)", async () => {
    const csv = [MEXC_HEADER, MEXC_ROW].join('\r\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'mexc.csv');
    expect(dtos).toHaveLength(1);
    expect(dtos[0].asset).toBe('BTC/USDT');
    expect(dtos[0].entry).toBe(73602.51); // séparateur de milliers correctement retiré
  });

  it('accepte un broker connu au-delà de 500 lignes (pas de bridage IA)', async () => {
    const rows = Array.from({ length: 600 }, () => MEXC_ROW);
    const csv = [MEXC_HEADER, ...rows].join('\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'mexc.csv');
    expect(dtos).toHaveLength(600);
  });

  it('lit un fichier Excel (.xlsx) converti localement', async () => {
    // MEXC stocke tout en texte dans le .xlsx : la cellule `73,602.51` (avec virgule)
    // ressort entre guillemets après sheet_to_csv (`"73,602.51"`) → vérifie le chemin
    // guillemets + séparateur de milliers via splitCsvLine quote-aware.
    const aoa = [MEXC_HEADER.split(';'), MEXC_ROW.split(';')];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const dtos = await svc.parseCSV(buf, 'export.xlsx');
    expect(dtos).toHaveLength(1);
    expect(dtos[0].asset).toBe('BTC/USDT');
    expect(dtos[0].side).toBe('SHORT');
    expect(dtos[0].entry).toBe(73602.51); // nombre entre guillemets + millier correctement parsés
  });
});

describe('CsvImportService — séparateur européen & limites', () => {
  let svc: CsvImportService;
  beforeEach(() => {
    svc = makeService();
  });

  it('normalise le séparateur `;` et les décimales `,`→`.`', () => {
    const input = 'a;b;c\n1,5;2,5;x';
    expect((svc as any).normalizeSeparator(input)).toBe('a,b,c\n1.5,2.5,x');
  });

  it('laisse intact un CSV déjà en virgules', () => {
    const input = 'a,b,c\n1.5,2.5,x';
    expect((svc as any).normalizeSeparator(input)).toBe(input);
  });

  it('refuse le chemin IA au-delà de 2000 lignes avec un message clair', async () => {
    const oldEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production'; // débloque le chemin IA pour atteindre la limite
    try {
      const rows = Array.from({ length: 2001 }, (_, i) => `v${i},w,z`);
      const csv = ['foo,bar,baz', ...rows].join('\n');
      await expect(
        svc.parseCSV(Buffer.from(csv), 'unknown.csv', undefined, PREMIUM_ACCESS),
      ).rejects.toThrow(/2000/);
    } finally {
      process.env['NODE_ENV'] = oldEnv;
    }
  });
});

describe('CsvImportService — chemin IA réservé Premium', () => {
  let svc: CsvImportService;
  beforeEach(() => {
    svc = makeService();
  });

  it('refuse le broker inconnu sans Premium (message clair, 0 appel Anthropic)', async () => {
    const create = vi.fn();
    (svc as any).anthropicClient.create = create;
    const csv = ['foo,bar,baz', 'v1,w,z', 'v2,w,z'].join('\n');

    await expect(
      svc.parseCSV(Buffer.from(csv), 'unknown.csv', undefined, {
        plan: Plan.FREE,
        role: Role.USER,
        trialEndsAt: null,
      }),
    ).rejects.toThrow(/Premium/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuse aussi un STARTER (Starter n’a pas d’IA)', async () => {
    const oldEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production';
    try {
      const create = vi.fn();
      (svc as any).anthropicClient.create = create;
      const csv = ['foo,bar,baz', 'v1,w,z'].join('\n');
      await expect(
        svc.parseCSV(Buffer.from(csv), 'unknown.csv', undefined, {
          plan: Plan.STARTER,
          role: Role.USER,
          trialEndsAt: null,
        }),
      ).rejects.toThrow(/Premium/);
      expect(create).not.toHaveBeenCalled();
    } finally {
      process.env['NODE_ENV'] = oldEnv;
    }
  });
});

describe('CsvImportService — chemin IA par lots', () => {
  let svc: CsvImportService;
  beforeEach(() => {
    svc = makeService();
  });

  it('traite un fichier inconnu de 600 lignes en 3 appels (lots de 250)', async () => {
    const trade = {
      asset: 'BTC/USDT',
      side: 'LONG',
      entry: 100,
      exit: 110,
      quantity: 1,
      pnl: 10,
      tradedAt: '2026-01-01T10:00:00Z',
      notes: null,
    };
    const create = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ broker: 'x', trades: [trade], skipped: 0, errors: [] }),
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    (svc as any).anthropicClient.create = create;

    const oldEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'production'; // chemin IA actif (Premium + prod)
    try {
      const rows = Array.from({ length: 600 }, (_, i) => `v${i},w,z`);
      const csv = ['foo,bar,baz', ...rows].join('\n');
      const dtos = await svc.parseCSV(
        Buffer.from(csv),
        'unknown.csv',
        undefined,
        PREMIUM_ACCESS,
      );

      expect(create).toHaveBeenCalledTimes(3); // 250 + 250 + 100
      expect(dtos).toHaveLength(3); // un trade agrégé par lot
    } finally {
      process.env['NODE_ENV'] = oldEnv;
    }
  });
});

describe('CsvImportService — defaults du lot (compte / émotion / setup)', () => {
  const csv = () => [MEXC_HEADER, MEXC_ROW].join('\r\n');

  it('applique accountId, emotion et setupId fournis à chaque dto', async () => {
    const svc = makeService();
    const dtos = await svc.parseCSV(Buffer.from(csv()), 'mexc.csv', 'user-1', undefined, undefined, {
      accountId: 'acc-9', emotion: 'FEAR', setupId: 'setup-7',
    });
    expect(dtos).toHaveLength(1);
    expect(dtos[0].accountId).toBe('acc-9');
    expect(dtos[0].emotion).toBe('FEAR');
    expect(dtos[0].setupId).toBe('setup-7');
  });

  it('émotion invalide → NEUTRAL (pas de crash) ; setup absent → défaut du user', async () => {
    const svc = makeService();
    const dtos = await svc.parseCSV(Buffer.from(csv()), 'mexc.csv', 'user-1', undefined, undefined, {
      emotion: 'PAS_UNE_EMOTION',
    });
    expect(dtos[0].emotion).toBe('NEUTRAL');
    expect(dtos[0].setupId).toBe('setup-default');
  });

  it('sans defaults → émotion NEUTRAL + setup par défaut du user', async () => {
    const svc = makeService();
    const dtos = await svc.parseCSV(Buffer.from(csv()), 'mexc.csv', 'user-1');
    expect(dtos[0].emotion).toBe('NEUTRAL');
    expect(dtos[0].setupId).toBe('setup-default');
  });
});

describe('CsvImportService — Fusion Tradovate (Performance + Cash history)', () => {
  const fixture = (name: string) =>
    readFileSync(join(__dirname, '__fixtures__', name));
  const perf = () => fixture('tradovate-performance.csv');
  const cash = () => fixture('tradovate-cash-history.csv');

  let svc: CsvImportService;
  beforeEach(() => {
    svc = makeService();
  });

  async function importWithFees() {
    const report: { fees?: FeesReport } = {};
    const dtos = await svc.parseCSV(
      perf(),
      'Performance.csv',
      undefined,
      undefined,
      undefined,
      undefined,
      { buffer: cash(), filename: 'Cash_History.csv' },
      report,
    );
    return { dtos, report };
  }

  it('parse 20 trades, tous avec une commission', async () => {
    const { dtos } = await importWithFees();
    expect(dtos).toHaveLength(20);
    for (const d of dtos) expect((d.commission ?? 0)).toBeGreaterThan(0);
  });

  it('attribue 21,84 (et non 24,96) → dédup des fills partagés', async () => {
    const { dtos, report } = await importWithFees();
    const total = +dtos.reduce((s, d) => s + (d.commission ?? 0), 0).toFixed(2);
    expect(total).toBe(21.84);
    expect(total).not.toBe(24.96);
    expect(report.fees?.assigned).toBe(21.84);
  });

  it('checksum : Σ commission(trade) == Σ |Delta| Commission (rapproché au centime)', async () => {
    const { dtos, report } = await importWithFees();
    const total = +dtos.reduce((s, d) => s + (d.commission ?? 0), 0).toFixed(2);
    expect(report.fees?.expected).toBe(21.84);
    expect(total).toBe(report.fees?.expected);
    expect(report.fees?.reconciled).toBe(true);
    expect(report.fees?.count).toBe(20);
  });

  it('compte chaque fill partagé une seule fois (3 fills partagés)', async () => {
    // Les 3 fills partagés (chaîne de scalping) valent 1,04 chacun = 3,12 de double
    // comptage évité (24,96 − 21,84). Les trades de la chaîne conservent une commission > 0.
    const { dtos } = await importWithFees();
    const chain = dtos.slice(0, 4).map((d) => d.commission ?? 0);
    // T1 = 1,04 + 1,04 (ses deux fills neufs) ; T2..T4 = 1,04 (un fill neuf, l'autre déjà consommé)
    expect(chain[0]).toBeCloseTo(2.08, 2);
    expect(chain[1]).toBeCloseTo(1.04, 2);
    expect(chain[2]).toBeCloseTo(1.04, 2);
    expect(chain[3]).toBeCloseTo(1.04, 2);
  });

  it('robustesse : $, espaces, Cash Change Type à espace de tête, lignes Trade Paired ignorées', async () => {
    // Les fixtures contiennent : Delta "-$1.04", " -1.04" (espace), un type " Commission"
    // (espace de tête), et des lignes "Trade Paired" (avec virgules) à ignorer.
    const { report } = await importWithFees();
    // Si les $/espaces cassaient le parsing, ou si Trade Paired était compté, total ≠ 21,84.
    expect(report.fees?.expected).toBe(21.84);
    expect(report.fees?.reconciled).toBe(true);
  });

  it('ne fusionne pas sans fichier de frais → commission absente (fallback inchangé)', async () => {
    const report: { fees?: FeesReport } = {};
    const dtos = await svc.parseCSV(
      perf(), 'Performance.csv', undefined, undefined, undefined, undefined, undefined, report,
    );
    expect(dtos).toHaveLength(20);
    expect(report.fees).toBeUndefined();
    expect(dtos.every((d) => d.commission == null)).toBe(true);
  });

  it('fichier de frais non-Cash-history → ignoré, pas de fusion', async () => {
    const report: { fees?: FeesReport } = {};
    await svc.parseCSV(
      perf(), 'Performance.csv', undefined, undefined, undefined, undefined,
      { buffer: Buffer.from('a,b,c\n1,2,3'), filename: 'autre.csv' }, report,
    );
    expect(report.fees).toBeUndefined();
  });

  it('métadonnées internes de fill id retirées avant persistance', async () => {
    const { dtos } = await importWithFees();
    for (const d of dtos) {
      expect(d).not.toHaveProperty('_buyFillId');
      expect(d).not.toHaveProperty('_sellFillId');
    }
  });
});
