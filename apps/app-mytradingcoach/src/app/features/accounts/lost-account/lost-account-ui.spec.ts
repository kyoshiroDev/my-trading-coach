import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, computed, signal, type Type } from '@angular/core';
import { FloorReachedBannerComponent } from './floor-reached-banner.component';
import { LostAccountSheetsComponent } from './lost-account-sheets.component';
import { FLOOR_SNOOZE_KEY } from './floor-snooze.util';
import { LostAccountFlowService } from '@app/core/services/lost-account-flow.service';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import type { TradingAccount } from '@app/core/api/accounts.api';
import BANNER from './floor-reached-banner.component.html?raw';
import SHEETS from './lost-account-sheets.component.html?raw';

/** Compte perdu, écrans 1, 2 et 4 : VRAIS templates (`?raw`), service du parcours simulé. */

const acc = (id: string, label: string, over: Partial<TradingAccount> = {}): TradingAccount =>
  ({ id, label, type: 'EVALUATION', status: 'ACTIVE', metrics: { tradesCount: 12 }, ...over }) as TradingAccount;

function flowStub(accounts: () => TradingAccount[]) {
  const choiceId = signal<string | null>(null);
  const retryId = signal<string | null>(null);
  return {
    choiceId, retryId,
    busy: signal(false),
    choiceAccount: computed(() => accounts().find((a) => a.id === choiceId()) ?? null),
    retryAccount: computed(() => accounts().find((a) => a.id === retryId()) ?? null),
    retryLabel: signal('Apex 50K #2'),
    openChoice: vi.fn((id: string) => choiceId.set(id)),
    closeChoice: vi.fn(() => choiceId.set(null)),
    openRetry: vi.fn((id: string) => retryId.set(id)),
    closeRetry: vi.fn(() => retryId.set(null)),
    confirmChoice: vi.fn(async () => undefined),
    createRetry: vi.fn(),
  };
}

function mount<T>(cmp: Type<T>, template: string, accounts: TradingAccount[]) {
  const list = signal(accounts);
  const flow = flowStub(list);
  TestBed.configureTestingModule({
    providers: [
      { provide: SelectedAccountStore, useValue: { accounts: list } },
      { provide: LostAccountFlowService, useValue: flow },
    ],
  });
  TestBed.overrideComponent(cmp, {
    set: { template, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(cmp);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q, flow, list };
}

describe('Bandeau « Plancher atteint » (écran 1)', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('un bandeau par compte au plancher estimé atteint, textes de la maquette', () => {
    const { q, el } = mount(FloorReachedBannerComponent, BANNER, [
      acc('a1', 'Apex 50K #1', { floorReached: true }),
      acc('a2', 'Topstep 150K', { floorReached: false }),
    ]);
    const banner = q('floor-banner-a1')!;
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('PLANCHER ATTEINT');
    expect(banner.textContent).toContain("d'après tes trades enregistrés, le plancher estimé est atteint. Vérifie chez ta firm.");
    expect(banner.textContent).toContain("Si l'évaluation est terminée, marque le compte comme échoué");
    expect(banner.textContent).toContain('Estimation MyTradingCoach, pas le calcul officiel de ta firm.');
    expect(q('floor-banner-a2')).toBeNull();
    expect(el.querySelectorAll('section').length).toBe(1);
  });

  it('compte funded : formulation adaptée (pas d\'« évaluation »)', () => {
    const { q } = mount(FloorReachedBannerComponent, BANNER, [acc('f', 'Apex PA', { type: 'FUNDED', floorReached: true })]);
    expect(q('floor-banner-f')!.textContent).toContain('Si le compte est perdu chez ta firm');
  });

  it('« Marquer comme échoué » ouvre la feuille de choix, aucun statut changé ici', () => {
    const { q, flow } = mount(FloorReachedBannerComponent, BANNER, [acc('a1', 'Apex 50K #1', { floorReached: true })]);
    q('floor-mark-failed-a1')!.click();
    expect(flow.openChoice).toHaveBeenCalledWith('a1');
  });

  it('« Pas maintenant » masque CE compte (24 h, stockage local) et laisse les autres', () => {
    const { q, fixture } = mount(FloorReachedBannerComponent, BANNER, [
      acc('a1', 'Apex 50K #1', { floorReached: true }),
      acc('a2', 'Apex 50K #2', { floorReached: true }),
    ]);
    q('floor-snooze-a1')!.click();
    fixture.detectChanges();
    expect(q('floor-banner-a1')).toBeNull();
    expect(q('floor-banner-a2')).not.toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(FLOOR_SNOOZE_KEY)!))).toEqual(['a1']);
  });

  it('masquage déjà enregistré : le bandeau reste caché au rechargement', () => {
    localStorage.setItem(FLOOR_SNOOZE_KEY, JSON.stringify({ a1: Date.now() + 60_000 }));
    const { q } = mount(FloorReachedBannerComponent, BANNER, [acc('a1', 'Apex 50K #1', { floorReached: true })]);
    expect(q('floor-banner-a1')).toBeNull();
  });
});

describe('Feuilles du compte perdu (écrans 2 et 4)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('feuille de choix : titre, trois options, « Archiver » cochée par défaut', () => {
    const { q, flow, fixture } = mount(LostAccountSheetsComponent, SHEETS, [acc('a1', 'Apex 50K #1')]);
    expect(q('lost-account-choice')).toBeNull();
    flow.openChoice('a1');
    fixture.detectChanges();
    const sheet = q('lost-account-choice')!;
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.textContent).toContain('Apex 50K #1 est échoué');
    expect(sheet.textContent).toContain('Ses trades sortent de tes statistiques. Que veux-tu en faire\u00a0?');
    expect(sheet.textContent).toContain('Ton compte MyTradingCoach et ton abonnement ne changent pas.');
    expect((q('lost-choice-archive') as HTMLInputElement).checked).toBe(true);
    expect((q('lost-choice-delete') as HTMLInputElement).checked).toBe(false);
  });

  it('Confirmer transmet le choix coché ; Annuler ferme sans rien enregistrer', () => {
    const { q, flow, fixture } = mount(LostAccountSheetsComponent, SHEETS, [acc('a1', 'Apex 50K #1')]);
    flow.openChoice('a1');
    fixture.detectChanges();
    (q('lost-choice-delete') as HTMLInputElement).click();
    fixture.detectChanges();
    q('lost-choice-confirm')!.click();
    expect(flow.confirmChoice).toHaveBeenCalledWith('delete');
    q('lost-choice-cancel')!.click();
    expect(flow.closeChoice).toHaveBeenCalled();
  });

  it('feuille rouverte pour un autre compte : « Archiver » de nouveau cochée', () => {
    const { q, flow, fixture } = mount(LostAccountSheetsComponent, SHEETS, [acc('a1', 'A #1'), acc('b1', 'B #1')]);
    flow.openChoice('a1');
    fixture.detectChanges();
    (q('lost-choice-keep') as HTMLInputElement).click();
    fixture.detectChanges();
    flow.openChoice('b1');
    fixture.detectChanges();
    expect((q('lost-choice-archive') as HTMLInputElement).checked).toBe(true);
  });

  it('nouvelle tentative : libellé annoncé, rappel Tradovate, « Créer … »', () => {
    const { q, flow, fixture } = mount(LostAccountSheetsComponent, SHEETS, [acc('a1', 'Apex 50K #1', { status: 'FAILED' })]);
    flow.openRetry('a1');
    fixture.detectChanges();
    const sheet = q('lost-account-retry')!;
    expect(sheet.textContent).toContain('Repartir sur une nouvelle tentative');
    expect(q('retry-label')!.textContent).toContain('Apex 50K #2');
    expect(sheet.textContent).toContain('Même firme · même plan · même taille');
    expect(sheet.textContent).toContain('relie le nouveau compte\u00a0: il a un autre identifiant chez ta firm');
    expect(q('retry-confirm')!.textContent).toContain('Créer Apex 50K #2');
    q('retry-confirm')!.click();
    expect(flow.createRetry).toHaveBeenCalled();
  });

  it('requête en cours : boutons désactivés (pas de double envoi)', () => {
    const { q, flow, fixture } = mount(LostAccountSheetsComponent, SHEETS, [acc('a1', 'Apex 50K #1')]);
    flow.openChoice('a1');
    flow.busy.set(true);
    fixture.detectChanges();
    expect((q('lost-choice-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect((q('lost-choice-cancel') as HTMLButtonElement).disabled).toBe(true);
  });
});
