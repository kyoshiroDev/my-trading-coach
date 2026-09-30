import { describe, it, expect, vi, beforeEach } from 'vitest';

const launch = vi.fn();
vi.mock('puppeteer', () => ({ default: { launch: (...a: unknown[]) => launch(...a) } }));

import { PdfService, escapeHtml, type DebriefPdfData } from './pdf.service';

const data = (over: Partial<DebriefPdfData> = {}): DebriefPdfData => ({
  currency: 'USD', weekNumber: 40, year: 2026, startDate: '28/09', endDate: '04/10', userName: 'Lucas',
  summary: 'Semaine solide.',
  stats: { totalTrades: 5, winRate: 60, totalPnl: 120, avgRR: 1.5, bestTrade: 80, worstTrade: -30 },
  insights: [], objectives: [], topTrades: [],
  ...over,
});

let active = 0;
let maxActive = 0;
let pages: { close: ReturnType<typeof vi.fn> }[] = [];

function fakeBrowser() {
  return {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn(async () => {
      const page = {
        setContent: vi.fn(async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
        }),
        waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
        pdf: vi.fn(async () => {
          active -= 1;
          return new Uint8Array([37, 80, 68, 70]);
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      pages.push(page);
      return page;
    }),
  };
}

beforeEach(() => {
  launch.mockReset();
  active = 0;
  maxActive = 0;
  pages = [];
});

describe('PdfService — un Chromium réutilisé, un rendu à la fois', () => {
  it('5 PDF demandés en même temps → 1 seul lancement de Chromium, rendus en série', async () => {
    launch.mockImplementation(async () => fakeBrowser());
    const svc = new PdfService();

    const pdfs = await Promise.all(Array.from({ length: 5 }, () => svc.generateDebriefPDF(data())));

    expect(launch).toHaveBeenCalledTimes(1);
    expect(maxActive).toBe(1);
    expect(pdfs).toHaveLength(5);
    expect(pages.every((p) => p.close.mock.calls.length === 1)).toBe(true); // aucune page oubliée
    await svc.onModuleDestroy();
  });

  it('un rendu qui échoue ne bloque pas les suivants et recycle le navigateur', async () => {
    const broken = fakeBrowser();
    broken.newPage.mockImplementationOnce(async () => ({
      setContent: vi.fn().mockRejectedValue(new Error('timeout')),
      waitForNetworkIdle: vi.fn(), pdf: vi.fn(), close: vi.fn().mockResolvedValue(undefined),
    }));
    launch.mockResolvedValueOnce(broken).mockImplementation(async () => fakeBrowser());
    const svc = new PdfService();

    await expect(svc.generateDebriefPDF(data())).rejects.toThrow('timeout');
    await expect(svc.generateDebriefPDF(data())).resolves.toBeInstanceOf(Buffer);
    expect(broken.close).toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(2);
    await svc.onModuleDestroy();
  });
});

describe('PdfService — texte IA et utilisateur échappé', () => {
  it('un <script> dans le résumé, le nom ou un insight est rendu en texte', () => {
    const html = (new PdfService() as unknown as { buildHTML: (d: DebriefPdfData) => string }).buildHTML(
      data({
        summary: '<script>alert(1)</script>',
        userName: '<img src=x onerror=alert(1)>',
        insights: [{ title: '<b>t</b>', description: 'a & b', type: 'positive' }],
      }),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('a &amp; b');
  });

  it('escapeHtml couvre les cinq caractères sensibles', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
    expect(escapeHtml(null)).toBe('');
  });
});
