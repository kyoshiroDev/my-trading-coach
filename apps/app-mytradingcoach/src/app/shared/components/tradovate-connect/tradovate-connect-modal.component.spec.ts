import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { TradovateConnectModalComponent } from './tradovate-connect-modal.component';
import { TradovateStore } from '../../../core/stores/tradovate.store';
import TEMPLATE from './tradovate-connect-modal.component.html?raw';

/**
 * Écran de réassurance (écran 2) : on rend le VRAI template (import `?raw`),
 * seules les icônes Lucide sont neutralisées (elles ne compilent pas en JIT sous vitest).
 */

const store = { authorizeUrl: vi.fn() };

function mount(inputs: { accountId?: string; accountLabel?: string; origin?: 'wizard' | 'settings' } = {}) {
  TestBed.configureTestingModule({ providers: [{ provide: TradovateStore, useValue: store }] });
  TestBed.overrideComponent(TradovateConnectModalComponent, {
    set: { template: TEMPLATE, imports: [], styleUrl: undefined as unknown as string, styleUrls: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(TradovateConnectModalComponent);
  // Entrées SIGNAL : ni `setInput` ni un hôte ne les alimentent en JIT sous vitest (limite
  // documentée dans csv-import-fees-pitch.spec.ts). On les remplace par des signaux avant le
  // premier rendu : le template et les méthodes les lisent de la même façon (`accountId()`).
  const cmp = fixture.componentInstance as unknown as Record<string, unknown> & { navigateTo: (u: string) => void };
  cmp['accountId'] = signal(inputs.accountId ?? 'acc-1');
  cmp['accountLabel'] = signal(inputs.accountLabel ?? 'Apex 50k · Éval');
  cmp['origin'] = signal(inputs.origin ?? 'settings');
  const navigate = vi.spyOn(cmp, 'navigateTo').mockImplementation(() => undefined);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { fixture, el, q, navigate, closed };
}

describe('Écran de réassurance Tradovate', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    store.authorizeUrl.mockReset();
  });

  it('affiche le compte cible, les 3 étapes et l’encadré lecture seule AVANT toute redirection', () => {
    const { el, q, navigate } = mount();
    expect(el.textContent).toContain('Connecter ton compte');
    expect(el.textContent).toContain('Pour le compte : Apex 50k · Éval');
    expect(el.querySelectorAll('.tvc-steps li')).toHaveLength(3);
    const note = q('tradovate-connect-security')!.textContent!;
    expect(note).toContain('ne voit jamais ton mot de passe');
    expect(note).toContain('Aucun ordre ne peut être passé');
    expect(note).toContain("révoquer l'accès à tout moment");
    // Rien n'est parti tant que l'utilisateur n'a pas confirmé.
    expect(store.authorizeUrl).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('« Connecter avec Tradovate » : demande l’URL pour CE compte et CETTE origine, puis redirige', () => {
    store.authorizeUrl.mockReturnValue(of('https://trader.tradovate.com/oauth?state=x'));
    const { q, navigate, fixture } = mount({ accountId: 'acc-9', origin: 'wizard' });
    q('tradovate-connect-confirm')!.click();
    fixture.detectChanges();
    expect(store.authorizeUrl).toHaveBeenCalledWith('acc-9', 'wizard');
    expect(navigate).toHaveBeenCalledWith('https://trader.tradovate.com/oauth?state=x');
    expect(q('tradovate-connect-confirm')!.textContent).toContain('Redirection');
  });

  it('échec de démarrage : message clair affiché, aucune redirection, on peut réessayer', () => {
    store.authorizeUrl.mockReturnValue(throwError(() => new HttpErrorResponse({
      status: 503,
      error: { code: 'TRADOVATE_NOT_CONFIGURED', message: "La connexion Tradovate n'est pas encore disponible." },
    })));
    const { q, navigate, fixture } = mount();
    q('tradovate-connect-confirm')!.click();
    fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    expect(q('tradovate-connect-error')!.textContent).toContain("n'est pas encore disponible");
    expect((q('tradovate-connect-confirm') as HTMLButtonElement).disabled).toBe(false);
  });

  it('erreur sans message serveur → repli lisible, jamais « undefined »', () => {
    store.authorizeUrl.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const { q, fixture } = mount();
    q('tradovate-connect-confirm')!.click();
    fixture.detectChanges();
    expect(q('tradovate-connect-error')!.textContent).toContain("n'a pas pu démarrer");
    expect(q('tradovate-connect-error')!.textContent).not.toContain('undefined');
  });

  it('« Annuler » ferme sans rien créer ni rediriger', () => {
    const { q, closed, navigate } = mount();
    q('tradovate-connect-cancel')!.click();
    expect(closed).toHaveBeenCalled();
    expect(store.authorizeUrl).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('aucun bouton ne suggère un passage d’ordre', () => {
    const { el } = mount();
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent ?? '').join(' ');
    expect(buttons).not.toMatch(/acheter|vendre|passer un ordre|trader maintenant|buy|sell/i);
  });
});
