/**
 * Audit fonctionnel #994 (lot 1d #998).
 * F12 : connexion avec un mot de passe de moins de 8 caractères (ou une adresse que @IsEmail refuse) :
 *       l'API répond 400 et l'écran disait « Une erreur est survenue », au lieu d'identifiants incorrects.
 * F22 : « mot de passe oublié » affichait « e-mail envoyé » même sur une panne (réseau, 500, 429).
 *       Le succès reste affiché quand l'API répond (anti-énumération : même réponse pour toute adresse).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { ForgotPasswordComponent } from './forgot-password.component';
import { AuthService } from '../../core/auth/auth.service';
import { PostSignupService } from '../../core/auth/post-signup.service';
import { GoogleSignInService } from '../../core/auth/google-sign-in.service';
import { GoogleIdentityService } from '../../core/auth/google-identity.service';

const fail = (status: number) => throwError(() => new HttpErrorResponse({ status }));

function mountLogin(status: number) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { login: vi.fn(() => fail(status)) } },
      { provide: PostSignupService, useValue: { afterLogin: vi.fn() } },
      { provide: GoogleSignInService, useValue: { signIn: vi.fn() } },
      { provide: GoogleIdentityService, useValue: { config: () => Promise.resolve({ enabled: false }) } },
    ],
  });
  TestBed.overrideComponent(LoginComponent, { set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = TestBed.createComponent(LoginComponent).componentInstance as any;
  c.email.set('trader@exemple.fr');
  c.password.set('court12');
  c.onLogin();
  return c;
}

function mountForgot(result: Observable<unknown>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { forgotPassword: vi.fn(() => result) } },
      { provide: GoogleIdentityService, useValue: { config: () => Promise.resolve({ enabled: false }) } },
    ],
  });
  TestBed.overrideComponent(ForgotPasswordComponent, { set: { template: '<div></div>', imports: [], styleUrls: [], styleUrl: undefined as unknown as string, schemas: [NO_ERRORS_SCHEMA] } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = TestBed.createComponent(ForgotPasswordComponent).componentInstance as any;
  c.email = 'trader@exemple.fr';
  c.onSubmit();
  return c;
}

beforeEach(() => TestBed.resetTestingModule());

describe('Connexion — message d’erreur', () => {
  it('400 (mot de passe trop court pour le DTO) → « Email ou mot de passe incorrect »', () => {
    expect(mountLogin(400).apiError()).toBe('Email ou mot de passe incorrect');
  });

  it('panne serveur → message de panne, pas « identifiants incorrects »', () => {
    expect(mountLogin(500).apiError()).toBe('Une erreur est survenue, réessaie dans un instant');
  });
});

describe('Mot de passe oublié — succès seulement si l’API a répondu', () => {
  it('204 → succès', () => {
    expect(mountForgot(of(undefined)).success()).toBe(true);
  });

  it.each([0, 500, 503])('panne (%s) → message d’erreur, pas de succès', (status) => {
    const c = mountForgot(fail(status));
    expect(c.success()).toBe(false);
    expect(c.error()).toBe('Le service ne répond pas. Réessaie dans un instant.');
  });

  it('429 → trop de demandes', () => {
    const c = mountForgot(fail(429));
    expect(c.success()).toBe(false);
    expect(c.error()).toBe('Trop de demandes. Réessaie dans quelques minutes.');
  });
});
