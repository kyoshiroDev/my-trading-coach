import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ResultsCardComponent } from './results-card.component';
import { ResultsCardData } from './results-card.util';
import TEMPLATE from './results-card.component.html?raw';

const DATA: ResultsCardData = {
  pnlLabel: '+$342.00',
  pnlPositive: true,
  winRateLabel: '67%',
  tradesCount: 6,
  moodEmoji: '😎',
  moodLabel: 'Confiant',
  dateLabel: 'Vendredi 2 octobre',
  dateLabelLong: 'Vendredi 2 octobre 2026',
  referralCode: 'GREG4X2',
};

function mount(data: Partial<ResultsCardData> = {}, format: 'square' | 'story' = 'square', chartUrl: string | null = null) {
  TestBed.resetTestingModule(); // plusieurs montages par test
  TestBed.overrideComponent(ResultsCardComponent, {
    set: { template: TEMPLATE, styleUrls: [], styleUrl: undefined as unknown as string },
  });
  const fixture = TestBed.createComponent(ResultsCardComponent);
  // Entrées SIGNAL non alimentées en JIT sous vitest (cf. csv-import-fees-pitch.spec.ts) :
  // remplacées par des signaux avant le premier rendu.
  const cmp = fixture.componentInstance as unknown as Record<string, unknown>;
  cmp['data'] = signal({ ...DATA, ...data });
  cmp['format'] = signal(format);
  cmp['chartUrl'] = signal(chartUrl);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('mtc-results-card', () => {
  it('affiche le lien de parrainage de l’utilisateur connecté, pas une valeur en dur', () => {
    const el = mount();
    expect(el.querySelector('[data-testid="rc-link"]')!.textContent).toBe('mytradingcoach.app/?ref=GREG4X2');
    expect(el.textContent).not.toContain('ref=VAL');
  });

  it('sans code : domaine seul, sans ?ref=', () => {
    const el = mount({ referralCode: null });
    expect(el.querySelector('[data-testid="rc-link"]')!.textContent).toBe('mytradingcoach.app');
  });

  it('dimensions exactes du format : 1080×1080 carré, 1080×1920 Story', () => {
    const square = mount();
    expect([square.style.width, square.style.height]).toEqual(['1080px', '1080px']);
    const story = mount({}, 'story');
    expect([story.style.width, story.style.height]).toEqual(['1080px', '1920px']);
    expect(story.classList.contains('story')).toBe(true);
    expect(story.textContent).toContain('Vendredi 2 octobre 2026');
  });

  it('P&L rouge si négatif, réduit si le libellé est long', () => {
    const pnl = mount({ pnlLabel: '-1,234.50 USDT', pnlPositive: false }).querySelector('[data-testid="rc-pnl"]')!;
    expect(pnl.classList.contains('neg')).toBe(true);
    expect(pnl.classList.contains('xlong')).toBe(true);
  });

  it('pas de « meilleur trade » : uniquement P&L, win rate, trades, humeur', () => {
    const el = mount();
    expect(el.textContent).not.toMatch(/meilleur/i);
    expect(el.textContent).toContain('67%');
    expect(el.textContent).toContain('Confiant');
  });

  it('graphique fourni : deux panneaux ; sans graphique : carte seule', () => {
    const alone = mount();
    expect(alone.classList.contains('split')).toBe(false);
    expect(alone.querySelector('[data-testid="rc-chart"]')).toBeNull();

    const split = mount({}, 'square', 'blob:chart');
    expect(split.classList.contains('split')).toBe(true);
    expect(split.querySelector('[data-testid="rc-chart"] img')!.getAttribute('src')).toBe('blob:chart');
  });
});
