import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { formatMoney, maxDrawdownOfTrades } from '@mtc/shared';
import { DashboardKpisComponent } from './dashboard-kpis.component';
import { tradeCountBars } from '../../dashboard-charts.util';
import { MoneyService } from '@app/core/services/money.service';
import { InfoTooltipComponent } from '@app/shared/components/info-tooltip/info-tooltip.component';
import { AnalyticsSummary } from '@app/core/api/analytics.api';

/**
 * Cas réel du prompt drawdown-max-par-trade : vendredi 06/11 −268 · −267,50 · +447 ; lundi 09/11
 * +1 406,50 · −253,60. Drawdown max = −535,50 (creux du vendredi), pas −88,50 (clôture du jour).
 */
const TRADES = [
  { closedAt: '2026-11-06T08:22:00Z', pnl: -268 },
  { closedAt: '2026-11-06T08:45:00Z', pnl: -267.5 },
  { closedAt: '2026-11-06T22:45:00Z', pnl: 447 },
  { closedAt: '2026-11-09T09:00:00Z', pnl: 1406.5 },
  { closedAt: '2026-11-09T10:00:00Z', pnl: -253.6 },
];
// Chiffres du résumé API sur ce jeu, calculés à la main : P&L 1 064,40 ; 2 gagnants / 5 = 40 % ;
// (447 + 1 406,5) / (268 + 267,5 + 253,6) = 2,35.
const SUMMARY: AnalyticsSummary = {
  winRate: 40, totalPnl: 1064.4, totalTrades: 5, maxDrawdown: 535.5, profitFactor: 2.35,
  streak: -1, topSession: '-', topSessionWinRate: 0, topHour: '-',
};

const usd = (v: number) => formatMoney(v, 'USD');

/** En JIT (vitest), une entrée signal n'est pas affectable par setInput : on remplace le signal. */
function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(DashboardKpisComponent);
  for (const [k, v] of Object.entries(inputs)) (fixture.componentInstance as unknown as Record<string, unknown>)[k] = signal(v);
  fixture.detectChanges();
  return fixture;
}

function renderCase() {
  const dd = maxDrawdownOfTrades(TRADES);
  return render({
    summary: SUMMARY, maxDrawdown: dd.maxDrawdown, drawdownSeries: dd.series, periodShort: 'sur 30 jours',
    periodStartCapital: 50_000, currentCapital: 51_064.4,
    // Vendredi 3 trades, lundi 2 trades → barres 100 % et 67 %.
    tradeBars: tradeCountBars([{ date: '2026-11-06', tradesCount: 3 }, { date: '2026-11-09', tradesCount: 2 }]),
  });
}

const card = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLElement>('.mtc-kpi')].find((c) => c.querySelector('.mtc-kpi-lab')?.textContent?.includes(label))!;

describe('DashboardKpisComponent — drawdown max par trade', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    // Dates fixes du cas réel : horloge figée au lundi 09/11/2026 (règle du dépôt).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T18:00:00Z'));
    TestBed.configureTestingModule({
      providers: [
        { provide: MoneyService, useValue: { currency: signal('USD'), format: (v: number, o?: object) => formatMoney(v, 'USD', o) } },
      ],
    });
    // Template externe lu sur disque (Vitest ne compile ni templateUrl ni le CSS).
    TestBed.overrideComponent(DashboardKpisComponent, {
      set: {
        template: readFileSync(resolve(import.meta.dirname, 'dashboard-kpis.component.html'), 'utf8'),
        templateUrl: undefined as unknown as string,
        styleUrls: [], styleUrl: undefined as unknown as string,
      },
    });
    TestBed.overrideComponent(InfoTooltipComponent, { set: { styleUrls: [], styleUrl: undefined as unknown as string } });
  });

  it('affiche le creux −535,50 $, pas la clôture du jour −88,50 $', () => {
    const el = renderCase().nativeElement as HTMLElement;
    const value = card(el, 'Drawdown max').querySelector('.mtc-kpi-val')!.textContent!.trim();
    expect(value).toBe(usd(-535.5));
    expect(value).not.toBe(usd(-88.5));
  });

  it('libellés : sous-titre « trades clôturés » et info-bulle sans précision intra-trade', () => {
    const fixture = renderCase();
    const el = fixture.nativeElement as HTMLElement;
    expect(card(el, 'Drawdown max').querySelector('.mtc-kpi-sub')!.textContent!.trim()).toBe('trades clôturés · sur 30 jours');
    // Libellés statiques du template (en JIT les entrées signal de l'enfant ne sont pas liées : on lit l'attribut).
    const tooltip = card(el, 'Drawdown max').querySelector('mtc-info-tooltip')!;
    expect(tooltip.getAttribute('label')).toBe('Comment le drawdown max est calculé');
    const tip = { text: () => tooltip.getAttribute('text') ?? '' };
    expect(tip.text()).toContain('Calculé sur les trades clôturés');
    expect(tip.text()).toContain('hors variations en cours de trade');
    expect(tip.text()).not.toContain('EOD');
  });

  it('non-régression des autres chiffres sur le même jeu : P&L, win rate, profit factor, trades', () => {
    const el = renderCase().nativeElement as HTMLElement;
    expect(card(el, 'P&L net').querySelector('.mtc-kpi-val')!.textContent!.trim()).toBe(usd(1064.4));
    expect(card(el, 'Win rate').querySelector('.mtc-kpi-val')!.textContent!.trim()).toBe('40.0%');
    expect(card(el, 'Profit factor').querySelector('.mtc-kpi-val')!.textContent!.trim()).toBe('2.35');
    expect(card(el, 'Trades pris').querySelector('.mtc-kpi-val')!.textContent!.trim()).toBe('5');
  });

  it('mini-graphiques : pas de sparkline profit factor, vraies barres de trades, drawdown rempli depuis le haut', () => {
    const el = renderCase().nativeElement as HTMLElement;
    expect(card(el, 'Profit factor').querySelector('svg')).toBeNull();
    const bars = [...card(el, 'Trades pris').querySelectorAll<HTMLElement>('.mtc-minibars span')];
    expect(bars.map((b) => b.style.height)).toEqual(['100%', '67%']);
    expect(bars.map((b) => b.getAttribute('title'))).toEqual(['6 nov. : 3 trades', '9 nov. : 2 trades']);
    const area = card(el, 'Drawdown max').querySelector('svg path')!.getAttribute('d')!;
    expect(area.endsWith('L72,0 L0,0 Z')).toBe(true);
  });

  it('tous les comptes : pire compte avec son nom, courbe masquée (jamais une série mélangée)', () => {
    // A +500, B −400 entrelacés : l'API renvoie −400 sur B.
    const el = render({
      summary: SUMMARY, maxDrawdown: -400, drawdownSeries: [], multiAccount: true,
      drawdownScope: 'sur le compte Lucid B', periodShort: 'sur 30 jours',
    }).nativeElement as HTMLElement;
    const ddCard = card(el, 'Drawdown max');
    expect(ddCard.querySelector('.mtc-kpi-val')!.textContent!.trim()).toBe(usd(-400));
    expect(ddCard.querySelector('.mtc-kpi-sub')!.textContent!.trim()).toBe('sur le compte Lucid B · sur 30 jours');
    expect(ddCard.querySelector('svg')).toBeNull();
    expect(ddCard.querySelector('.mtc-kpi-hint')!.textContent!.trim()).toBe('Choisis un compte pour voir la courbe');
  });

  it('tous les comptes sans nom de compte (ancien cache) : sous-titre standard, courbe masquée, aucune erreur', () => {
    const el = render({ summary: SUMMARY, maxDrawdown: -400, multiAccount: true, drawdownScope: null, periodShort: 'sur 30 jours' }).nativeElement as HTMLElement;
    const ddCard = card(el, 'Drawdown max');
    expect(ddCard.querySelector('.mtc-kpi-sub')!.textContent!.trim()).toBe('trades clôturés · sur 30 jours');
    expect(ddCard.querySelector('svg')).toBeNull();
  });

  it('info-bulle : définition trade par trade et cas « tous les comptes »', () => {
    const tooltip = card(renderCase().nativeElement, 'Drawdown max').querySelector('mtc-info-tooltip')!;
    expect(tooltip.getAttribute('text')).toContain('Plus forte baisse depuis un sommet, trade par trade, sur la période.');
    expect(tooltip.getAttribute('text')).toContain('Tous comptes : le compte le plus touché.');
  });

  it('aucun trade : 0 et « Aucune donnée »', () => {
    const fixture = render({ summary: { ...SUMMARY, totalTrades: 0, totalPnl: 0, winRate: 0, profitFactor: null }, maxDrawdown: 0 });
    const ddCard = card(fixture.nativeElement, 'Drawdown max');
    expect(ddCard.querySelector('.mtc-kpi-val')!.textContent!.trim()).toBe(usd(0));
    expect(ddCard.querySelector('.mtc-kpi-sub')!.textContent!.trim()).toBe('Aucune donnée');
    // Aucune barre décorative sans données.
    expect(card(fixture.nativeElement, 'Trades pris').querySelector('.mtc-minibars')).toBeNull();
  });
});
