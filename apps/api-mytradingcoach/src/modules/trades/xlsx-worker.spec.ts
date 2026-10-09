import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { xlsxToCsv } from './xlsx-worker';

/** Classeur réel en mémoire : une feuille, en-tête + `rows` lignes. */
function workbook(rows: number): Buffer {
  const data = [['Symbol', 'P&L'], ...Array.from({ length: rows }, (_, i) => [`NQ${i}`, i])];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'Trades');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('xlsxToCsv — Excel lu hors de la boucle d’événements (SCA-B5-05)', () => {
  it('première feuille convertie en CSV', async () => {
    await expect(xlsxToCsv(workbook(2), 100)).resolves.toBe('Symbol,P&L\nNQ0,0\nNQ1,1');
  });

  it('au plus `sheetRows` lignes lues (en-tête comprise)', async () => {
    const csv = await xlsxToCsv(workbook(50), 5);
    expect(csv.split('\n')).toHaveLength(5);
  });

  it('fichier illisible → rejet propre, pas de plantage du process', async () => {
    await expect(xlsxToCsv(Buffer.from('PK\u0003\u0004 pas un vrai classeur'), 100)).rejects.toThrow();
  });

  it('lecture trop longue → worker tué au délai', async () => {
    await expect(xlsxToCsv(workbook(20_000), 30_000, 1)).rejects.toThrow(/interrompue/);
  });

  it('pendant une grosse lecture, la boucle d’événements continue de tourner', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const csv = await xlsxToCsv(workbook(20_000), 30_000);
    clearInterval(timer);
    expect(csv.split('\n')).toHaveLength(20_001);
    expect(ticks).toBeGreaterThan(5); // bloquée, elle n'aurait pas tourné du tout
  });

  it('appels simultanés → traités un par un, tous aboutissent', async () => {
    const results = await Promise.all([1, 2, 3].map((n) => xlsxToCsv(workbook(n), 100)));
    expect(results.map((r) => r.split('\n').length)).toEqual([2, 3, 4]);
  });
});
