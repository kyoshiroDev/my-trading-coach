import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from './register.component';
import TEMPLATE from './register.component.html?raw';
import { AuthService } from '../../core/auth/auth.service';
import { OfferIntentService } from '../../core/services/offer-intent.service';
import { SignupFunnelService } from '../../core/services/signup-funnel.service';
import { PostSignupService } from '../../core/auth/post-signup.service';

/**
 * Formulaire d'inscription sans `@angular/forms` (#765) : VRAI template, champs liés aux signaux par
 * `[value]` / `(input)`, case par `[checked]` / `(change)`, envoi par `(submit)` sans rechargement.
 */
function mount(register = vi.fn(() => of({}))) {
  const postSignup = { afterSignup: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { isAuthenticated: signal(false), register } },
      { provide: OfferIntentService, useValue: { capture: vi.fn(), pending: signal(null), needsChoice: signal(false) } },
      { provide: SignupFunnelService, useValue: { start: vi.fn(), track: vi.fn() } },
      { provide: PostSignupService, useValue: postSignup },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
    ],
  });
  TestBed.overrideComponent(RegisterComponent, {
    set: { template: TEMPLATE, imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] },
  });
  const fixture = TestBed.createComponent(RegisterComponent);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
  const type = (sel: string, value: string) => {
    const input = q<HTMLInputElement>(sel)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = () => {
    const ev = new Event('submit', { cancelable: true });
    q('form')!.dispatchEvent(ev);
    fixture.detectChanges();
    return ev;
  };
  return { fixture, el, q, type, submit, register, postSignup };
}

afterEach(() => {
  TestBed.resetTestingModule();
  localStorage.clear();
  sessionStorage.clear();
});

describe('Inscription sans @angular/forms (#765)', () => {
  it('formulaire en novalidate (pas de bulles natives), envoi sans rechargement de page', () => {
    const { q, submit } = mount();
    expect(q('form')!.hasAttribute('novalidate')).toBe(true);
    expect(submit().defaultPrevented).toBe(true);
  });

  it('champs vides : les erreurs s’affichent et rien n’est envoyé', () => {
    const { el, submit, register } = mount();
    submit();
    expect(el.querySelector('#email-error')!.textContent).toContain("L'adresse email est requise");
    expect(el.querySelector('#password-error')!.textContent).toContain('Le mot de passe est requis');
    expect(register).not.toHaveBeenCalled();
  });

  it('valeurs saisies (ou autoremplies) lues par (input), case marketing par (change) : envoi complet', () => {
    const { q, type, submit, register, postSignup } = mount();
    type('#name', 'Alex');
    type('[data-testid="register-email"]', 'alex@test.fr');
    type('[data-testid="register-password"]', 'Motdepasse1');
    type('[data-testid="register-confirm"]', 'Motdepasse1');
    const box = q<HTMLInputElement>('input[name="marketingConsent"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    submit();
    expect(register).toHaveBeenCalledWith('alex@test.fr', 'Motdepasse1', 'Alex', undefined, true, expect.any(Object));
    expect(postSignup.afterSignup).toHaveBeenCalled();
  });

  it('les signaux repeuplent les champs (valeur affichée = valeur envoyée)', () => {
    const { q, type, fixture } = mount();
    type('[data-testid="register-email"]', 'a@b.fr');
    fixture.detectChanges();
    expect(q<HTMLInputElement>('[data-testid="register-email"]')!.value).toBe('a@b.fr');
  });

  it('compte déjà existant (409) : message affiché', () => {
    const { q, type, submit } = mount(vi.fn(() => throwError(() => ({ status: 409 }))));
    type('[data-testid="register-email"]', 'alex@test.fr');
    type('[data-testid="register-password"]', 'Motdepasse1');
    type('[data-testid="register-confirm"]', 'Motdepasse1');
    submit();
    expect(q('[data-testid="error-message"]')!.textContent).toContain('Un compte existe déjà');
  });
});
