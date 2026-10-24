import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { NEVER, type Observable, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import type { AccountIncidentReport } from '@mtc/shared';
import { AUTOPSY_TIMEOUT_MS, AccountAutopsyComponent } from './account-autopsy.component';
import { DemoService } from '@app/core/services/demo.service';
import { mockupReport } from './autopsy.fixture';
import { AccountsApi } from '@app/core/api/accounts.api';
import { SelectedAccountStore } from '@app/core/stores/selected-account.store';
import { TradesStore } from '@app/core/stores/trades.store';
import { UserStore } from '@app/core/stores/user.store';
import { LostAccountFlowService } from '@app/core/services/lost-account-flow.service';
import { ToastService } from '@app/core/services/toast.service';
import { ConfirmService } from '@mtc/front-ui';
import TEMPLATE from './account-autopsy.component.html?raw';

/** Page d'autopsie (#669) : VRAI template (`?raw`), API et parcours simulés. */

type IncidentResponse = Observable<{ data: AccountIncidentReport }>;

function mount(
  report: AccountIncidentReport,
  opts: {
    premium?: boolean; demo?: boolean; confirm?: boolean; incident?: () => IncidentResponse; accountsLoading?: boolean;
    newer?: { id: string; label: string };
  } = {},
) {
  const api = {
    incident: vi.fn(opts.incident ?? (() => of({ data: report }))),
    incidentAnalysis: vi.fn(() => of({ data: { status: 'ready', text: "D'après tes trades enregistrés, deux phases.", generatedAt: '2026-10-14T09:20:00.000Z' } })),
    dismissIncident: vi.fn(() => of({ data: { dismissed: true, reactivated: report.canReactivate } })),
  };
  const flow = { busy: signal(false), openRetry: vi.fn(), openAttempt: vi.fn(), newerAttempt: vi.fn(() => opts.newer ?? null) };
  const store = { loaded: signal(!opts.accountsLoading), isLoading: signal(!!opts.accountsLoading), load: vi.fn() };
  const router = { navigate: vi.fn(async () => true) };
  const confirm = { ask: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ accountId: 'acc', incidentId: 'inc' })) } },
      { provide: Router, useValue: router },
      { provide: SelectedAccountStore, useValue: store },
      { provide: TradesStore, useValue: { reset: vi.fn() } },
      { provide: UserStore, useValue: { isPremium: signal(!!opts.premium), trialAvailable: signal(true), isDemo: signal(!!opts.demo) } },
      { provide: LostAccountFlowService, useValue: flow },
      { provide: ConfirmService, useValue: confirm },
    ],
  });
  TestBed.overrideComponent(AccountAutopsyComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(AccountAutopsyComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q, api, flow, store, router, confirm };
}

describe('Autopsie — page', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('Gratuit : chronologie, 3 constats, note d’estimation, analyse verrouillée sans appel IA', () => {
    const { q, el, api } = mount(mockupReport());
    expect(q('autopsy-status')!.textContent).toContain('Échoué');
    expect(q('autopsy-headline')!.textContent).toContain('Plancher estimé franchi le 14 oct. à 11:12');
    expect(q('autopsy-timeline')!.querySelectorAll('li')).toHaveLength(6);
    expect(q('autopsy-timeline')!.textContent).toContain("Après l'alerte");
    expect(q('autopsy-findings')!.querySelectorAll('li')).toHaveLength(3);
    expect(el.textContent).toContain("L'heure d'entrée n'est pas enregistrée\u00a0: la distance est une estimation calculée sur les trades clôturés.");
    // Espace insécable devant « : ; ! ? » partout sur la page (revue #712).
    expect(el.textContent).not.toMatch(/ [:;!?]/);
    expect(q('autopsy-ai-locked')!.textContent).toContain('Essayer Premium · 1 mois offert');
    expect(api.incidentAnalysis).not.toHaveBeenCalled();
  });

  it('Premium, analyse pas encore générée : demandée une seule fois, puis affichée avec sa date', () => {
    const { q, api, fixture } = mount(mockupReport({ ai: { status: 'pending' } }), { premium: true });
    fixture.detectChanges();
    expect(api.incidentAnalysis).toHaveBeenCalledTimes(1);
    expect(q('autopsy-ai')!.textContent).toContain("D'après tes trades enregistrés, deux phases.");
    expect(q('autopsy-ai')!.textContent).toContain('Elle ne prédit rien et ne constitue pas un conseil. Générée une seule fois le 14 oct. à 11:20.');
  });

  it('compte démo : analyse préenregistrée signalée comme exemple, aucun appel', () => {
    const { q, api } = mount(mockupReport({ ai: { status: 'ready', text: "D'après tes trades enregistrés…", generatedAt: '2026-10-14T09:20:00.000Z' } }), { premium: true, demo: true });
    expect(api.incidentAnalysis).not.toHaveBeenCalled();
    // Le badge lui-même (la note contient aussi « Exemple » : elle ne suffit pas à le prouver).
    expect(q('autopsy-ai-example-badge')!.textContent!.trim()).toBe('Exemple');
    expect(q('autopsy-ai-example')!.textContent).toContain("Exemple préenregistré du compte démo, sans appel à l'IA.");
  });

  it('analyse déjà conservée : aucun nouvel appel', () => {
    const { q, api } = mount(mockupReport({ ai: { status: 'ready', text: 'Texte conservé.', generatedAt: '2026-10-14T09:20:00.000Z' } }), { premium: true });
    expect(api.incidentAnalysis).not.toHaveBeenCalled();
    // Hors démo : jamais de badge « Exemple ».
    expect(q('autopsy-ai-example-badge')).toBeNull();
    expect(q('autopsy-ai')!.textContent).toContain('Texte conservé.');
  });

  it('analyse en échec : message neutre, rien d’inventé', () => {
    const report = mockupReport({ ai: { status: 'pending' } });
    const { q, api, fixture } = mount(report, { premium: true });
    api.incidentAnalysis.mockReturnValue(throwError(() => new Error('503')));
    (fixture.componentInstance as unknown as { load(): void }).load();
    fixture.detectChanges();
    expect(q('autopsy-ai-wait')!.textContent).toContain('Analyse indisponible pour le moment.');
  });

  it('« Repartir sur une nouvelle tentative » ouvre la feuille du compte échoué', () => {
    const { q, flow } = mount(mockupReport());
    q('autopsy-retry')!.click();
    expect(flow.openRetry).toHaveBeenCalledWith('acc');
  });

  it('tentative suivante déjà créée (B3) : « Voir Apex 50K #2 » à la place de « Repartir… »', () => {
    const { q, flow } = mount(mockupReport(), { newer: { id: 'acc-2', label: 'Apex 50K #2' } });
    expect(q('autopsy-retry')).toBeNull();
    expect(q('autopsy-see-attempt')!.textContent!.trim()).toBe('Voir Apex 50K #2');
    q('autopsy-see-attempt')!.click();
    expect(flow.openAttempt).toHaveBeenCalledWith('acc-2');
    expect(flow.openRetry).not.toHaveBeenCalled();
  });

  it('compte archivé : pas de nouvelle tentative (réservée aux comptes échoués)', () => {
    const { q } = mount(mockupReport({ account: { id: 'acc', label: 'x', currency: 'USD', status: 'ARCHIVED' } }));
    expect(q('autopsy-retry')).toBeNull();
  });

  it("« Ce n'est pas un échec » : confirmé, retire, recharge les comptes, annonce la réactivation, revient à Mes comptes", async () => {
    const { q, api, store, router, confirm } = mount(mockupReport());
    q('autopsy-dismiss')!.click();
    await vi.waitFor(() => expect(api.dismissIncident).toHaveBeenCalledWith('acc', 'inc'));
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Retirer l'autopsie\u00a0?", confirmLabel: "Retirer l'autopsie",
      message: expect.stringContaining('redeviendra actif'),
    }));
    expect(store.load).toHaveBeenCalled();
    expect(TestBed.inject(ToastService).visible()[0]).toMatchObject({
      type: 'success', message: '« Apex 50K · Éval #1 » est de nouveau actif. Autopsie retirée.',
    });
    expect(router.navigate).toHaveBeenCalledWith(['/accounts']);
  });

  it("« Ce n'est pas un échec » annulé : rien n'est retiré", async () => {
    const { q, api, confirm, router } = mount(mockupReport(), { confirm: false });
    q('autopsy-dismiss')!.click();
    await vi.waitFor(() => expect(confirm.ask).toHaveBeenCalled());
    await Promise.resolve();
    expect(api.dismissIncident).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('autopsie non confirmée ou échec marqué à la main (B2) : « Retirer cette autopsie », même confirmation', async () => {
    const { el, q, api, confirm } = mount(mockupReport({ canReactivate: false }));
    expect(q('autopsy-dismiss')!.textContent!.trim()).toBe('Retirer cette autopsie');
    expect(el.textContent).not.toContain("Ce n'est pas un échec");
    expect(el.textContent).toContain("Retirer l'autopsie ne change pas le statut du compte.");
    q('autopsy-dismiss')!.click();
    await vi.waitFor(() => expect(api.dismissIncident).toHaveBeenCalledWith('acc', 'inc'));
    expect(confirm.ask).toHaveBeenCalledWith(expect.objectContaining({
      title: "Retirer l'autopsie\u00a0?", confirmLabel: "Retirer l'autopsie",
      message: 'Elle ne reviendra pas. Le statut du compte ne change pas.',
    }));
  });

  it('échec confirmé depuis cette autopsie : le bouton reste « Ce n’est pas un échec »', () => {
    const { q } = mount(mockupReport({ canReactivate: true }));
    expect(q('autopsy-dismiss')!.textContent!.trim()).toBe("Ce n'est pas un échec");
  });

  it('autopsie introuvable ou d’un autre utilisateur (404) : message neutre, pas de « réessaie »', () => {
    const { el, api, fixture, q } = mount(mockupReport());
    api.incident.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    (fixture.componentInstance as unknown as { load(): void }).load();
    fixture.detectChanges();
    expect(q('autopsy-not-found')!.textContent).toContain("Cette autopsie n'existe pas ou n'est plus disponible.");
    expect(el.querySelector('mtc-error-state')).toBeNull();
    expect(el.textContent).not.toMatch(/connexion|réessai/i);
  });

  it('chargement en échec : état d’erreur avec réessai', () => {
    const { el, api, fixture } = mount(mockupReport());
    api.incident.mockReturnValue(throwError(() => new Error('500')));
    (fixture.componentInstance as unknown as { load(): void }).load();
    fixture.detectChanges();
    expect(el.querySelector('mtc-error-state')).not.toBeNull();
  });

  describe('chargement (A3) : jamais sans fin', () => {
    it('404 dès la première réponse : message neutre tout de suite, même si la liste des comptes charge encore', () => {
      const { q } = mount(mockupReport(), {
        accountsLoading: true,
        incident: () => throwError(() => new HttpErrorResponse({ status: 404 })),
      });
      expect(q('autopsy-loading')).toBeNull();
      expect(q('autopsy-not-found')!.textContent).toContain("Cette autopsie n'existe pas ou n'est plus disponible.");
    });

    it('adresse mal formée (400) : même message neutre', () => {
      const { q } = mount(mockupReport(), {
        incident: () => throwError(() => new HttpErrorResponse({ status: 400 })),
      });
      expect(q('autopsy-not-found')).not.toBeNull();
    });

    it('5xx ou réseau coupé : état d’erreur, « Réessayer » relance la requête', () => {
      for (const status of [503, 0]) {
        TestBed.resetTestingModule();
        const { el, api, fixture, q } = mount(mockupReport(), {
          incident: () => throwError(() => new HttpErrorResponse({ status })),
        });
        expect(el.querySelector('mtc-error-state')).not.toBeNull();
        expect(q('autopsy-loading')).toBeNull();
        api.incident.mockReturnValue(of({ data: mockupReport() }));
        (fixture.componentInstance as unknown as { load(): void }).load();
        fixture.detectChanges();
        expect(api.incident).toHaveBeenCalledTimes(2);
        expect(q('autopsy-findings')).not.toBeNull();
      }
    });

    it(`aucune réponse : chargement, puis état d’erreur au bout de ${AUTOPSY_TIMEOUT_MS / 1000} s`, () => {
      vi.useFakeTimers();
      try {
        const { el, fixture, q } = mount(mockupReport(), { incident: () => NEVER });
        expect(q('autopsy-loading')).not.toBeNull();
        vi.advanceTimersByTime(AUTOPSY_TIMEOUT_MS);
        fixture.detectChanges();
        expect(q('autopsy-loading')).toBeNull();
        expect(el.querySelector('mtc-error-state')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it('démo : « Ce n’est pas un échec » ouvre « Crée ton compte » au premier clic, sans confirmation ni requête', async () => {
    const { q, api, confirm } = mount(mockupReport(), { demo: true });
    q('autopsy-dismiss')!.click();
    await Promise.resolve();
    expect(TestBed.inject(DemoService).showSignupPrompt()).toBe(true);
    expect(confirm.ask).not.toHaveBeenCalled();
    expect(api.dismissIncident).not.toHaveBeenCalled();
  });

  describe('courbe (A8) : jamais affichée d’abord à la largeur par défaut', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('largeur de la carte connue au premier rendu : courbe tracée à cette largeur, visible tout de suite', () => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
      const { el } = mount(mockupReport());
      TestBed.tick();
      expect(el.querySelector('svg.chart')!.getAttribute('width')).toBe('640');
      expect(el.querySelector('.chart-box')!.classList).not.toContain('pending');
    });

    it('carte pas encore mesurée : courbe masquée, puis affichée à la largeur relevée', () => {
      let report: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
      vi.stubGlobal('ResizeObserver', class {
        constructor(cb: typeof report) { report = cb; }
        observe() { /* rien */ }
        disconnect() { /* rien */ }
      });
      const { el } = mount(mockupReport());
      TestBed.tick();
      expect(el.querySelector('.chart-box')!.classList).toContain('pending');
      report!([{ contentRect: { width: 700 } }]);
      TestBed.tick();
      expect(el.querySelector('svg.chart')!.getAttribute('width')).toBe('700');
      expect(el.querySelector('.chart-box')!.classList).not.toContain('pending');
    });
  });

  it('grand écran (A7) : ordre du DOM inchangé (chiffres, courbe, chronologie, constats, analyse, boutons)', () => {
    const { el } = mount(mockupReport());
    const order = [...el.querySelectorAll('[data-testid^="autopsy-"]')].map((n) => n.getAttribute('data-testid'));
    const pick = ['autopsy-chart', 'autopsy-timeline', 'autopsy-findings', 'autopsy-ai-locked', 'autopsy-retry', 'autopsy-dismiss'];
    expect(order.filter((id) => pick.includes(id!))).toEqual(pick);
    // Analyse IA et boutons regroupés dans la 3e zone ; constats hors de ce groupe.
    const side = el.querySelector('.side')!;
    expect(side.querySelector('[data-testid="autopsy-ai-locked"]')).not.toBeNull();
    expect(side.querySelector('[data-testid="autopsy-dismiss"]')).not.toBeNull();
    expect(side.querySelector('[data-testid="autopsy-findings"]')).toBeNull();
  });
});
