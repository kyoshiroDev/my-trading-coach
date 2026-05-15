import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';

export interface DebriefPdfData {
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  userName: string;
  summary: string;
  stats: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    avgRR: number;
    bestTrade: number;
    worstTrade: number;
  };
  insights: {
    title: string;
    description: string;
    type: 'positive' | 'negative' | 'neutral';
  }[];
  objectives: {
    title: string;
    reason: string;
  }[];
  topTrades: {
    asset: string;
    side: string;
    pnl: number;
    tradedAt: string;
  }[];
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generateDebriefPDF(data: DebriefPdfData): Promise<Buffer> {
    const html = this.buildHTML(data);
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env['PUPPETEER_EXECUTABLE_PATH'],
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      return Buffer.from(pdfBuffer);
    } finally {
      if (browser) await browser.close();
    }
  }

  private buildHTML(data: DebriefPdfData): string {
    const pnlColor = data.stats.totalPnl >= 0 ? '#2dd4bf' : '#fc8181';
    const pnlSign = data.stats.totalPnl >= 0 ? '+' : '';

    const insightsHTML = data.insights
      .map(
        (insight) => `
      <div class="insight insight-${insight.type}">
        <div class="insight-dot"></div>
        <div>
          <div class="insight-title">${insight.title}</div>
          <div class="insight-desc">${insight.description}</div>
        </div>
      </div>`,
      )
      .join('');

    const objectivesHTML = data.objectives
      .map(
        (obj, i) => `
      <div class="objective">
        <div class="objective-num">${i + 1}</div>
        <div>
          <div class="objective-title">${obj.title}</div>
          <div class="objective-reason">${obj.reason}</div>
        </div>
      </div>`,
      )
      .join('');

    const tradesHTML = data.topTrades
      .slice(0, 5)
      .map((trade) => {
        const color = trade.pnl >= 0 ? '#2dd4bf' : '#fc8181';
        const sign = trade.pnl >= 0 ? '+' : '';
        return `
        <tr>
          <td>${trade.asset}</td>
          <td class="side-${trade.side.toLowerCase()}">${trade.side}</td>
          <td style="color: ${color}">${sign}$${trade.pnl.toFixed(2)}</td>
          <td class="date">${new Date(trade.tradedAt).toLocaleDateString('fr-FR')}</td>
        </tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', sans-serif;
    background: #080f1a;
    color: #e2e8f0;
    width: 210mm;
    min-height: 297mm;
  }
  .page { padding: 32px 36px; min-height: 297mm; }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 24px;
    border-bottom: 1px solid rgba(99,179,237,0.15);
    margin-bottom: 28px;
  }
  .brand { font-size: 13px; color: #4a6080; letter-spacing: 0.1em; text-transform: uppercase; }
  .week-title { font-size: 22px; font-weight: 700; color: #e2e8f0; margin-top: 4px; }
  .week-dates { font-size: 12px; color: #4a6080; margin-top: 4px; }
  .pnl-header { text-align: right; }
  .pnl-label { font-size: 10px; color: #4a6080; letter-spacing: 0.08em; text-transform: uppercase; }
  .pnl-value { font-size: 28px; font-weight: 700; color: ${pnlColor}; margin-top: 2px; }
  .stats-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 28px;
  }
  .stat-box {
    background: #0d1827; border: 1px solid rgba(99,179,237,0.1);
    border-radius: 10px; padding: 14px;
  }
  .stat-box-label { font-size: 9px; color: #4a6080; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px; }
  .stat-box-value { font-size: 20px; font-weight: 600; color: #e2e8f0; font-family: 'Courier New', monospace; }
  .section { margin-bottom: 24px; }
  .section-title {
    font-size: 10px; font-weight: 600; letter-spacing: 0.12em;
    text-transform: uppercase; color: #4a6080; margin-bottom: 12px;
  }
  .summary-text {
    font-size: 13px; color: #a0b4c8; line-height: 1.6;
    background: #0d1827; border: 1px solid rgba(99,179,237,0.1);
    border-radius: 10px; padding: 16px;
  }
  .insight {
    display: flex; gap: 12px; padding: 12px; border-radius: 8px; margin-bottom: 8px;
    background: #0d1827; border: 1px solid rgba(99,179,237,0.08);
  }
  .insight-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
  .insight-positive .insight-dot { background: #2dd4bf; }
  .insight-negative .insight-dot { background: #fc8181; }
  .insight-neutral .insight-dot { background: #63b3ed; }
  .insight-title { font-size: 12px; font-weight: 600; color: #e2e8f0; margin-bottom: 3px; }
  .insight-desc { font-size: 11px; color: #7fa8cc; line-height: 1.4; }
  .objective {
    display: flex; gap: 12px; padding: 12px;
    background: #0d1827; border: 1px solid rgba(99,179,237,0.08);
    border-radius: 8px; margin-bottom: 8px;
  }
  .objective-num {
    width: 24px; height: 24px; border-radius: 50%;
    background: rgba(99,179,237,0.1); color: #63b3ed;
    font-size: 11px; font-weight: 700;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .objective-title { font-size: 12px; font-weight: 600; color: #e2e8f0; margin-bottom: 3px; }
  .objective-reason { font-size: 11px; color: #7fa8cc; }
  table { width: 100%; border-collapse: collapse; }
  th {
    font-size: 9px; color: #4a6080; letter-spacing: 0.1em; text-transform: uppercase;
    text-align: left; padding: 0 12px 8px; border-bottom: 1px solid rgba(99,179,237,0.1);
  }
  td {
    font-size: 12px; color: #a0b4c8; padding: 10px 12px;
    border-bottom: 1px solid rgba(99,179,237,0.05);
    font-family: 'Courier New', monospace;
  }
  .side-long { color: #2dd4bf; }
  .side-short { color: #fc8181; }
  .date { color: #4a6080; font-size: 11px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .footer {
    margin-top: 32px; padding-top: 16px;
    border-top: 1px solid rgba(99,179,237,0.08);
    display: flex; justify-content: space-between; align-items: center;
  }
  .footer-brand { font-size: 10px; color: #4a6080; letter-spacing: 0.08em; }
  .footer-date { font-size: 10px; color: #4a6080; }
</style>
</head>
<body>
<div class="page">

  <div class="header">
    <div>
      <div class="brand">MyTradingCoach</div>
      <div class="week-title">Weekly Debrief — Semaine ${data.weekNumber}</div>
      <div class="week-dates">${data.startDate} → ${data.endDate} · ${data.userName}</div>
    </div>
    <div class="pnl-header">
      <div class="pnl-label">P&L semaine</div>
      <div class="pnl-value">${pnlSign}$${data.stats.totalPnl.toFixed(2)}</div>
    </div>
  </div>

  <div class="stats-grid">
    <div class="stat-box">
      <div class="stat-box-label">Trades</div>
      <div class="stat-box-value">${data.stats.totalTrades}</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-label">Win Rate</div>
      <div class="stat-box-value">${data.stats.winRate.toFixed(1)}%</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-label">R/R moyen</div>
      <div class="stat-box-value">${data.stats.avgRR.toFixed(1)}</div>
    </div>
    <div class="stat-box">
      <div class="stat-box-label">Best trade</div>
      <div class="stat-box-value" style="color:#2dd4bf">+$${data.stats.bestTrade.toFixed(2)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Résumé de la semaine</div>
    <div class="summary-text">${data.summary}</div>
  </div>

  <div class="two-col">
    <div class="section">
      <div class="section-title">Insights IA</div>
      ${insightsHTML}
    </div>
    <div class="section">
      <div class="section-title">Objectifs semaine prochaine</div>
      ${objectivesHTML}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Top trades de la semaine</div>
    <table>
      <thead>
        <tr><th>Asset</th><th>Side</th><th>P&L</th><th>Date</th></tr>
      </thead>
      <tbody>${tradesHTML}</tbody>
    </table>
  </div>

  <div class="footer">
    <div class="footer-brand">mytradingcoach.app</div>
    <div class="footer-date">Généré le ${new Date().toLocaleDateString('fr-FR')}</div>
  </div>

</div>
</body>
</html>`;
  }
}
