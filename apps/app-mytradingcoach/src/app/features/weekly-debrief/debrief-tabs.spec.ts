import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, WritableSignal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DebriefComponent } from './debrief.component';
import { UserStore } from '../../core/stores/user.store';

 
function account(id: string, over: Record<string, any> = {}): any {
  return {
    accountId: id, name: id, type: 'PERSONAL', status: 'ACTIVE',
    stats: { totalTrades: 0, winRate: 0, totalPnl: 0 },
    rules: null, summary: '', strengths: [], weaknesses: [], objectives: [], propNote: null,
    ...over,
  };
}

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      // isPremium=false → le constructeur ne lance pas le polling (aucun HTTP).
      { provide: UserStore, useValue: { isPremium: () => false } },
    ],
  });
  TestBed.overrideComponent(DebriefComponent, {
    set: { imports: [], template: '<div></div>', styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(DebriefComponent);
   
  return fixture.componentInstance as any;
}

 
function setDebrief(cmp: any, insights: any, extra: Record<string, any> = {}) {
  (cmp.debrief as WritableSignal<unknown>).set({
    id: 'd1', weekNumber: 25, year: 2026, startDate: '', endDate: '',
    aiSummary: 'résumé legacy', insights, objectives: [], stats: { winRate: 0, totalPnl: 0, totalTrades: 0 },
    generatedAt: '', ...extra,
  });
}

describe('DebriefComponent — onglets par compte', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('expose les comptes et la vue d\'ensemble depuis insights', () => {
    const cmp = setup();
    setDebrief(cmp, { overview: { summary: 'vue cross-compte' }, accounts: [account('acc-perso'), account('acc-eval', { type: 'EVALUATION' })] });
    expect(cmp.accounts()).toHaveLength(2);
    expect(cmp.overviewSummary()).toBe('vue cross-compte');
  });

  it('resolvedTab retombe sur « overview » si l\'onglet persisté n\'existe pas', () => {
    const cmp = setup();
    setDebrief(cmp, { overview: { summary: 's' }, accounts: [account('acc-1')] });
    cmp.activeTab.set('compte-inexistant');
    expect(cmp.resolvedTab()).toBe('overview');
    expect(cmp.activeAccount()).toBeNull();
  });

  it('sélectionner un compte → resolvedTab et activeAccount pointent dessus', () => {
    const cmp = setup();
    setDebrief(cmp, { overview: { summary: 's' }, accounts: [account('acc-1'), account('acc-2', { summary: 'analyse 2' })] });
    cmp.selectTab('acc-2');
    expect(cmp.resolvedTab()).toBe('acc-2');
    expect(cmp.activeAccount().summary).toBe('analyse 2');
  });

  it('compte prop firm → isProp true, badge ÉVAL', () => {
    const cmp = setup();
    const eval50 = account('acc-eval', { type: 'EVALUATION', rules: { startingBalance: 50000, profitTarget: 3000, maxDrawdown: 2500, drawdownType: 'TRAILING' }, propNote: 'estimation ...' });
    expect(cmp.isProp(eval50)).toBe(true);
    expect(cmp.typeBadge('EVALUATION')).toEqual({ label: 'ÉVAL', cls: 'eval' });
    expect(cmp.typeBadge('PERSONAL')).toBeNull();
  });

  it('rétrocompat : ancien débrief à plat (sans accounts) → overview depuis aiSummary, forces à plat', () => {
    const cmp = setup();
    setDebrief(cmp, { summary: 'ancien', strengths: [{ badge: 'Force', text: 'x' }], weaknesses: [] }, { aiSummary: 'ancien' });
    expect(cmp.accounts()).toHaveLength(0);
    expect(cmp.overviewSummary()).toBe('ancien'); // aiSummary (canonique pour un legacy)
    expect(cmp.legacyStrengths()).toHaveLength(1);
  });

  it('overviewSummary retombe sur aiSummary si insights vide', () => {
    const cmp = setup();
    setDebrief(cmp, {});
    expect(cmp.overviewSummary()).toBe('résumé legacy');
  });
});

describe('DebriefComponent — trades autour des annonces (#670)', () => {
  beforeEach(() => TestBed.resetTestingModule());
  const acc = (accountId: string | null, inside: number) => ({
    accountId, inside: { count: inside, pnl: -63, winRate: 50 }, outside: { count: 2, pnl: 78, winRate: 100 },
  });

  it('deux lignes par compte ayant un trade autour d’une annonce, nom du compte, P&L dans sa devise', () => {
    const cmp = setup();
    setDebrief(cmp, { overview: { summary: 's' }, accounts: [account('acc-apex', { name: 'Apex 50k' })] }, {
      stats: { winRate: 0, totalPnl: 0, totalTrades: 6, newsWindow: { windowMinutes: 5, accounts: [acc('acc-apex', 2), acc('acc-perso', 0)] } },
    });
    const nw = cmp.newsWindow();
    expect(nw.windowMinutes).toBe(5);
    expect(nw.rows.map((r: { label: string; accountId: string }) => [r.label, r.accountId])).toEqual([
      ['Apex 50k · autour des annonces', 'acc-apex'],
      ['Apex 50k · reste de la semaine', 'acc-apex'],
    ]);
  });

  it('ancien débrief sans la stat, ou aucun trade dans une fenêtre : bloc masqué (jamais « 0 »)', () => {
    const cmp = setup();
    setDebrief(cmp, {});
    expect(cmp.newsWindow()).toBeNull();
    setDebrief(cmp, {}, { stats: { winRate: 0, totalPnl: 0, totalTrades: 2, newsWindow: { windowMinutes: 5, accounts: [acc('a', 0)] } } });
    expect(cmp.newsWindow()).toBeNull();
  });

  it('trades sans compte : libellé « Sans compte »', () => {
    const cmp = setup();
    setDebrief(cmp, {}, { stats: { winRate: 0, totalPnl: 0, totalTrades: 3, newsWindow: { windowMinutes: 5, accounts: [acc(null, 1)] } } });
    expect(cmp.newsWindow().rows[0].label).toBe('Sans compte · autour des annonces');
  });
});
