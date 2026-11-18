import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LoginComponent } from './login.component';
import { environment } from '@admin/environments/environment';

/**
 * A18 (#1065) : connexion avec un compte non ADMIN, bouton bloqué sur « Connexion… », aucun
 * message, et le jeton restait enregistré dans le navigateur.
 */
describe('LoginComponent — compte non administrateur (A18 #1065)', () => {
  let http: HttpTestingController;
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { http.verify(); localStorage.clear(); });

  it('rôle USER : message, bouton rendu, aucun jeton gardé, session fermée côté serveur', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    await fixture.whenStable(); // ngModel écrit sa valeur initiale de façon asynchrone
    const el = fixture.nativeElement as HTMLElement;
    const set = (id: string, v: string) => {
      const input = el.querySelector(`#${id}`) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    set('login-email', 'trader@test.local');
    set('login-password', 'secret-de-test');
    fixture.detectChanges();
    await fixture.whenStable();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne(`${environment.apiUrl}/auth/login`).flush({
      data: { access_token: 'jeton-de-test', user: { id: 'u1', email: 'trader@test.local', plan: 'FREE', role: 'USER' } },
    });
    http.expectOne(`${environment.apiUrl}/auth/logout`).flush({});
    fixture.detectChanges();
    expect(el.querySelector('.login-error')?.textContent).toContain('pas accès');
    expect((el.querySelector('.btn-login') as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem('admin_access_token')).toBeNull();
  });
});
