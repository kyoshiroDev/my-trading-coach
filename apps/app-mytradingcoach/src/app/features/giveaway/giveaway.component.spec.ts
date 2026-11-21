import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { of, throwError } from 'rxjs';
import type { GiveawayAppState, GiveawayMyWin } from '@mtc/shared';
import { GiveawayComponent, countdownLabel, drawDayLabel } from './giveaway.component';
import { GiveawayWinnerComponent } from './giveaway-winner.component';
import { GiveawayStateService } from '../../core/services/giveaway-state.service';
import { GiveawayApi } from '../../core/api/giveaway.api';
import { UserStore } from '../../core/stores/user.store';
import TEMPLATE from './giveaway.component.html?raw';
import WINNER_TEMPLATE from './giveaway-winner.component.html?raw';

/** Page « Concours du mois » et page gagnant (PROMPT-tirage-mensuel, lot B) : VRAIS gabarits (`?raw`). */

const NOW = new Date('2027-02-10T10:00:00Z');

const WIN: GiveawayMyWin = {
  id: 'w1', period: '2027-02', pool: 'FREE', prizeMonths: 1,
  startsAt: '2027-02-01T08:00:00.000Z', endsAt: '2027-03-01T08:00:00.000Z', activationStatus: 'APPLIED',
  displayConsent: 'NONE', displayPseudo: null, message: null, moderation: 'EN_ATTENTE',
  instagramConsent: false, instagramHandle: null,
};

function state(over: Partial<GiveawayAppState> = {}): GiveawayAppState {
  return {
    enabled: true, free: true, premium: true, freePrizeMonths: 1, premiumPrizeMonths: 3, minTrades: 5,
    nextDrawAt: '2027-03-01T08:00:00.000Z', winnersFree: 2, winnersPremium: 1, monthsOffered: 5,
    winners: [
      { period: '2027-02', pool: 'FREE', displayName: 'Léa M.', prizeMonths: 1, message: 'Merci, ça motive !' },
      { period: '2027-01', pool: 'PREMIUM', displayName: 'Un trader', prizeMonths: 3, message: null },
    ],
    demo: false, me: { pool: 'FREE', reason: 'need_trades', tradesThisMonth: 3 }, myWin: null,
    ...over,
  };
}

function storeFor(s: GiveawayAppState | null, loadError = false) {
  const st = signal(s);
  return { state: st, loadError: signal(loadError), loading: signal(false), enabled: computed(() => st()?.enabled ?? false), load: vi.fn(), reset: vi.fn() };
}

function mountPage(s: GiveawayAppState | null, loadError = false) {
  const store = storeFor(s, loadError);
  TestBed.configureTestingModule({ providers: [{ provide: GiveawayStateService, useValue: store }] });
  TestBed.overrideComponent(GiveawayComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(GiveawayComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q, store };
}

describe('Concours du mois : page', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('lots, prochain tirage et compte à rebours', () => {
    const { q } = mountPage(state());
    expect(q('giveaway-prize-free')!.textContent).toContain('1\u00a0mois de Premium');
    expect(q('giveaway-prize-premium')!.textContent).toContain('3\u00a0mois offerts');
    expect(q('giveaway-countdown')!.textContent).toContain('Prochain tirage le 1er mars à 9\u00a0h');
    expect(q('giveaway-countdown')!.textContent).toContain('18\u00a0j 22\u00a0h');
  });

  it('mon statut : « Encore 2 trades » et barre de progression à 60 %', () => {
    const { q } = mountPage(state());
    expect(q('giveaway-status-text')!.textContent).toBe('Encore 2\u00a0trades pour participer au tirage du 1er mars.');
    const fill = q('giveaway-status')!.querySelector('.bar-fill') as HTMLElement;
    expect(fill.style.width).toBe('60%');
  });

  it('dans le tirage : « Tu es dans le tirage du 1er mars »', () => {
    const { q } = mountPage(state({ me: { pool: 'FREE', reason: 'in', tradesThisMonth: 7 } }));
    expect(q('giveaway-status-text')!.textContent).toBe('Tu es dans le tirage du 1er mars.');
  });

  it('Premium de moins de 2 mois : phrase honnête, sans barre', () => {
    const { q } = mountPage(state({ me: { pool: 'PREMIUM', reason: 'premium_too_recent', tradesThisMonth: 9 } }));
    expect(q('giveaway-status-text')!.textContent).toBe('Tu participeras au tirage Premium dès ton 2e\u00a0mois d’abonnement.');
    expect(q('giveaway-status')!.querySelector('.bar')).toBeNull();
  });

  it('compteurs réels ; aucun gagnant → « Premier tirage le 1er mars » au lieu de 0', () => {
    const { q } = mountPage(state());
    expect(q('giveaway-counters')!.textContent).toContain('5');
    TestBed.resetTestingModule();
    const empty = mountPage(state({ winnersFree: 0, winnersPremium: 0, monthsOffered: 0, winners: [] }));
    expect(empty.q('giveaway-first-draw')!.textContent).toContain('le 1er mars');
    expect(empty.q('giveaway-counters')!.textContent).not.toContain('0');
    expect(empty.q('giveaway-winners')).toBeNull();
  });

  it('gagnants : nom selon l’accord, message seulement s’il est fourni (validé côté API)', () => {
    const { q } = mountPage(state());
    const list = q('giveaway-winners')!;
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(list.textContent).toContain('Léa M.');
    expect(list.textContent).toContain('Merci, ça motive !');
    expect(list.textContent).toContain('Un trader');
  });

  it('conditions et lien vers le règlement', () => {
    const { q } = mountPage(state());
    expect(q('giveaway-conditions')!.querySelectorAll('li')).toHaveLength(4);
    expect(q('giveaway-rules-link')!.getAttribute('href')).toMatch(/\/reglement-tirage$/);
  });

  it('démo : mention « exemple », aucun gagnant', () => {
    const { q } = mountPage(state({ demo: true, winners: [], winnersFree: 0, winnersPremium: 0, monthsOffered: 0 }));
    expect(q('giveaway-demo-note')!.textContent).toContain('Exemple');
    expect(q('giveaway-winners')).toBeNull();
  });

  it('lot gagné : lien vers la page gagnant', () => {
    const { q } = mountPage(state({ myWin: WIN }));
    expect(q('giveaway-my-win')).not.toBeNull();
  });

  it('chargement puis erreur', () => {
    expect(mountPage(null).q('giveaway-loading')).not.toBeNull();
    TestBed.resetTestingModule();
    const { el, store } = mountPage(null, true);
    expect(el.querySelector('mtc-error-state')).not.toBeNull();
    expect(store.load).toHaveBeenCalled();
  });

  it('espace insécable devant « : ; ! ? » partout', () => {
    // Textes de la page seulement : les messages des gagnants sont saisis par eux.
    const { el } = mountPage(state({ winners: [] }));
    const m = /.{0,30} [:;!?].{0,10}/.exec(el.textContent ?? '');
    expect(m?.[0] ?? null).toBeNull();
  });
});

describe('Concours du mois : utilitaires', () => {
  it('jour du tirage et compte à rebours', () => {
    expect(drawDayLabel('2027-03-01T08:00:00.000Z')).toBe('1er mars');
    expect(countdownLabel('2027-03-01T08:00:00.000Z', Date.parse('2027-03-01T05:40:00Z'))).toBe('2\u00a0h 20\u00a0min');
    expect(countdownLabel('2027-03-01T08:00:00.000Z', Date.parse('2027-03-01T08:00:30Z'))).toBe('moins d’une minute');
  });
});

describe('Page gagnant', () => {
  beforeEach(() => TestBed.resetTestingModule());

  function mountWinner(s: GiveawayAppState, opts: { demo?: boolean; fail?: boolean } = {}) {
    const store = storeFor(s);
    const api = {
      updateMyWin: vi.fn((dto: Record<string, unknown>) =>
        opts.fail ? throwError(() => ({ error: { message: 'Pseudo Instagram invalide.' }, status: 400 })) : of({ data: { ...WIN, ...dto } })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: GiveawayStateService, useValue: store },
        { provide: GiveawayApi, useValue: api },
        { provide: UserStore, useValue: { isDemo: signal(!!opts.demo) } },
      ],
    });
    TestBed.overrideComponent(GiveawayWinnerComponent, {
      set: { template: WINNER_TEMPLATE, imports: [FormsModule, DatePipe], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(GiveawayWinnerComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    return { fixture, el, q, api, store };
  }

  it('lot activé et date de fin ; Instagram décoché par défaut', async () => {
    const { q, fixture } = mountWinner(state({ myWin: WIN }));
    await fixture.whenStable();
    expect(q('winner-prize')!.textContent).toContain('1\u00a0mois de Premium offert');
    expect((q('winner-instagram-consent') as HTMLInputElement).checked).toBe(false);
    expect((q('winner-consent-none') as HTMLInputElement).checked).toBe(true);
  });

  it('enregistrer : envoie les choix, message vide → null', async () => {
    const { q, fixture, api } = mountWinner(state({ myWin: WIN }));
    await fixture.whenStable();
    (q('winner-consent-initial') as HTMLInputElement).click();
    fixture.detectChanges();
    (q('winner-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(api.updateMyWin).toHaveBeenCalledWith({
      displayConsent: 'PRENOM_INITIALE', displayPseudo: null, message: null, instagramConsent: false, instagramHandle: null,
    });
    expect(q('winner-saved')).not.toBeNull();
  });

  it('erreur de l’API affichée', async () => {
    const { q, fixture } = mountWinner(state({ myWin: WIN }), { fail: true });
    await fixture.whenStable();
    (q('winner-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(q('winner-error')!.textContent).toContain('Pseudo Instagram invalide.');
  });

  it('aucun lot : message et lien vers le concours', () => {
    const { q } = mountWinner(state({ myWin: null }));
    expect(q('winner-none')).not.toBeNull();
  });

  it('démo : bouton d’enregistrement désactivé', async () => {
    const { q, fixture } = mountWinner(state({ myWin: WIN }), { demo: true });
    await fixture.whenStable();
    expect((q('winner-save') as HTMLButtonElement).disabled).toBe(true);
  });
});
