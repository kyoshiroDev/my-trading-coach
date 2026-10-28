import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { GoogleFinalizeComponent } from './google-finalize.component';
import { AuthService } from '../../core/auth/auth.service';
import { PostSignupService } from '../../core/auth/post-signup.service';

const auth = {
  currentUser: signal<Record<string, unknown> | null>(null),
  finalizeGoogleSignup: vi.fn(() => of({ data: {} })),
};
const postSignup = { afterSignup: vi.fn(), afterLogin: vi.fn() };

function create(query: Record<string, string> = {}) {
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: PostSignupService, useValue: postSignup },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
    schemas: [NO_ERRORS_SCHEMA],
  });
  TestBed.overrideComponent(GoogleFinalizeComponent, { set: { template: '<div></div>', imports: [], styleUrls: [] } });
  return TestBed.createComponent(GoogleFinalizeComponent).componentInstance as unknown as {
    marketingConsent: ReturnType<typeof signal<boolean>>;
    onContinue: () => void;
  };
}

describe('GoogleFinalizeComponent (#618)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.currentUser.set({ name: 'Alex Martin', email: 'a@b.c', needsSignupFinalization: true });
  });

  it('opt-in marketing NON coché par défaut : continuer sans toucher envoie false', () => {
    const c = create();
    expect(c.marketingConsent()).toBe(false);
    c.onContinue();
    expect(auth.finalizeGoogleSignup).toHaveBeenCalledWith(false);
    expect(postSignup.afterSignup).toHaveBeenCalledOnce();
  });

  it('case cochée → true, puis la suite du parcours', () => {
    const c = create();
    c.marketingConsent.set(true);
    c.onContinue();
    expect(auth.finalizeGoogleSignup).toHaveBeenCalledWith(true);
    expect(postSignup.afterSignup).toHaveBeenCalledOnce();
  });

  it('déjà finalisée → pas de second choix, suite du parcours', () => {
    auth.currentUser.set({ email: 'a@b.c', needsSignupFinalization: false });
    create();
    expect(postSignup.afterLogin).toHaveBeenCalledOnce();
  });
});
