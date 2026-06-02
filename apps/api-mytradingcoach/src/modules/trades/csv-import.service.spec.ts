import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { CsvImportService } from './csv-import.service';

// Anthropic SDK lit la clé à la construction → fournir une valeur factice en test
process.env['ANTHROPIC_API_KEY'] = 'test-key';

const MEXC_HEADER =
  'UID;Futures;Open Time(UTC+02:00);Close Time;Margin Mode;Avg Entry Price;Avg Close Price;Direction;Closing Qty (Cont.);Fee;Realized PNL;Status';

const MEXC_ROW =
  '65370223;BTCUSDT;2026-05-30 12:11:40;2026-05-30 14:31:55;Isolated;73602.51;73692.56;Short;550;1.6202459USDT;-6.5727459USDT;All Closed';

function makeService() {
  const aiLogger = { log: vi.fn() } as any;
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } } as any;
  return new CsvImportService(aiLogger, prisma);
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

  it('accepte un broker connu au-delà de 500 lignes (pas de bridage IA)', async () => {
    const rows = Array.from({ length: 600 }, () => MEXC_ROW);
    const csv = [MEXC_HEADER, ...rows].join('\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'mexc.csv');
    expect(dtos).toHaveLength(600);
  });

  it('lit un fichier Excel (.xlsx) converti localement', async () => {
    const aoa = [MEXC_HEADER.split(';'), MEXC_ROW.split(';')];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const dtos = await svc.parseCSV(buf, 'export.xlsx');
    expect(dtos).toHaveLength(1);
    expect(dtos[0].asset).toBe('BTC/USDT');
    expect(dtos[0].side).toBe('SHORT');
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
    const rows = Array.from({ length: 2001 }, (_, i) => `v${i},w,z`);
    const csv = ['foo,bar,baz', ...rows].join('\n');
    await expect(svc.parseCSV(Buffer.from(csv), 'unknown.csv')).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.parseCSV(Buffer.from(csv), 'unknown.csv')).rejects.toThrow(
      /2000/,
    );
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
    (svc as any).anthropic.messages.create = create;

    const rows = Array.from({ length: 600 }, (_, i) => `v${i},w,z`);
    const csv = ['foo,bar,baz', ...rows].join('\n');
    const dtos = await svc.parseCSV(Buffer.from(csv), 'unknown.csv');

    expect(create).toHaveBeenCalledTimes(3); // 250 + 250 + 100
    expect(dtos).toHaveLength(3); // un trade agrégé par lot
  });
});
