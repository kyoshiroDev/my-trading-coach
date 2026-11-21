import { describe, it, expect } from 'vitest';
import { ACCENT, dailyRecapTemplate, debriefReadyTemplate, pnlTone } from './index';
import { firstTradeTemplate, type CampaignBuildCtx } from '../campaigns/campaign-templates';

// Le vert est réservé aux gains, e-mails compris (décision de Greg du 2026-11-21, #1163) :
// un P&L nul n'est ni un gain ni une perte, et une coche n'est pas un gain.
const GREEN = '#10b981';
const RED = '#ef4444';

describe('pnlTone : couleur d’un P&L dans les e-mails', () => {
  it('vert pour un gain, rouge pour une perte, neutre pour 0', () => {
    expect(pnlTone(12.5)).toMatchObject({ color: GREEN, accent: ACCENT.success });
    expect(pnlTone(0.01).color).toBe(GREEN);
    expect(pnlTone(-0.01)).toMatchObject({ color: RED, accent: ACCENT.brand });
    const zero = pnlTone(0);
    expect(zero.color).not.toBe(GREEN);
    expect(zero.color).not.toBe(RED);
    expect(zero.accent).toBe(ACCENT.brand);
    expect(pnlTone(-0)).toEqual(zero);
  });

  it('jugé au centime, comme le montant affiché : un reste de somme est neutre', () => {
    expect(pnlTone(0.1 + 0.2 - 0.3).color).toBe(pnlTone(0).color);
    expect(pnlTone(0.004).color).toBe(pnlTone(0).color);
    expect(pnlTone(-0.004).color).toBe(pnlTone(0).color);
    expect(pnlTone(0.005).color).toBe(GREEN);
  });
});

describe('récap du jour et débrief : P&L de 0 en couleur neutre', () => {
  const daily = (pnl: number) => dailyRecapTemplate({
    userName: 'Trader', date: new Date('2026-11-09T18:00:00Z'), pnl, winRate: 50, tradesCount: 2,
    aiOneLiner: null, currency: 'USD', appUrl: 'https://app.example',
  }).html;
  const debrief = (totalPnl: number) => debriefReadyTemplate({
    userName: 'Trader', weekNumber: 45, winRate: 50, totalPnl, totalTrades: 2, currency: 'USD', appUrl: 'https://app.example',
  }).html;

  it.each([['récap du jour', daily], ['débrief', debrief]] as const)('%s : ni vert ni rouge à 0', (_name, render) => {
    const html = render(0);
    expect(html).not.toContain(GREEN);
    expect(html).not.toContain(RED);
    expect(html).not.toContain('rgba(16,185,129');
  });

  it.each([['récap du jour', daily], ['débrief', debrief]] as const)('%s : vert pour un gain, rouge pour une perte', (_name, render) => {
    expect(render(120)).toContain(GREEN);
    expect(render(-120)).toContain(RED);
    expect(render(-120)).not.toContain(GREEN);
  });
});

describe('récap du jour : emoji de l’objet', () => {
  const subject = (pnl: number) => dailyRecapTemplate({
    userName: 'Trader', date: new Date('2026-11-09T18:00:00Z'), pnl, winRate: 50, tradesCount: 2,
    aiOneLiner: null, currency: 'USD', appUrl: 'https://app.example',
  }).subject;

  it('📈 pour un gain, 📉 pour une perte, 📊 pour 0', () => {
    expect(subject(120).startsWith('📈')).toBe(true);
    expect(subject(-120).startsWith('📉')).toBe(true);
    expect(subject(0).startsWith('📊')).toBe(true);
    expect(subject(0.1 + 0.2 - 0.3).startsWith('📊')).toBe(true);
  });
});

describe('campagne « premier trade » : coches sans vert', () => {
  it('les coches ✓ sont en bleu de marque', () => {
    const ctx: CampaignBuildCtx = { userName: 'Trader', appUrl: 'https://app.example', unsubUrl: 'https://api.example/u' };
    const { html } = firstTradeTemplate(ctx);
    expect(html).toContain('✓');
    expect(html).not.toContain(GREEN);
  });
});
