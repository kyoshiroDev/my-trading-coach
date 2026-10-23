import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import type { AccountIncidentReport } from '@mtc/shared';
import { AccountAutopsyComponent } from './account-autopsy.component';
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

function mount(report: AccountIncidentReport, opts: { premium?: boolean; demo?: boolean; confirm?: boolean } = {}) {
  const api = {
    incident: vi.fn(() => of({ data: report })),
    incidentAnalysis: vi.fn(() => of({ data: { status: 'ready', text: "D'après tes trades enregistrés, deux phases.", generatedAt: '2026-10-14T09:20:00.000Z' } })),
    dismissIncident: vi.fn(() => of({ data: { dismissed: true, reactivated: report.canReactivate } })),
  };
  const flow = { busy: signal(false), openRetry: vi.fn() };
  const store = { loaded: signal(true), isLoading: signal(false), load: vi.fn() };
  const router = { navigate: vi.fn(async () => true) };
  const confirm = { ask: vi.fn(async () => opts.confirm ?? true) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AccountsApi, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ accountId: 'acc', incidentId: 'inc' }) } } },
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
    expect(q('autopsy-ai')!.textContent).toContain('Exemple');
    expect(q('autopsy-ai-example')!.textContent).toContain("Exemple préenregistré du compte démo, sans appel à l'IA.");
  });

  it('analyse déjà conservée : aucun nouvel appel', () => {
    const { q, api } = mount(mockupReport({ ai: { status: 'ready', text: 'Texte conservé.', generatedAt: '2026-10-14T09:20:00.000Z' } }), { premium: true });
    expect(api.incidentAnalysis).not.toHaveBeenCalled();
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

  it('échec marqué à la main : la note dit que le statut ne change pas', () => {
    const { el } = mount(mockupReport({ canReactivate: false }));
    expect(el.textContent).toContain("« Ce n'est pas un échec » retire l'autopsie. Le statut du compte ne change pas.");
  });

  it('chargement en échec : état d’erreur avec réessai', () => {
    const { el, api, fixture } = mount(mockupReport());
    api.incident.mockReturnValue(throwError(() => new Error('500')));
    (fixture.componentInstance as unknown as { load(): void }).load();
    fixture.detectChanges();
    expect(el.querySelector('mtc-error-state')).not.toBeNull();
  });
});
