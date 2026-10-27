import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, of } from 'rxjs';
import { AuthService } from './auth.service';
import { PostSignupService } from './post-signup.service';
import { ToastService } from '../services/toast.service';
import { GOOGLE_FINALIZE_PATH, GoogleSignInService, googleAuthErrorMessage } from './google-sign-in.service';

const auth = { googleAuth: vi.fn() };
const router = { navigate: vi.fn() };
const postSignup = { afterLogin: vi.fn(), afterSignup: vi.fn() };
const toast = { success: vi.fn() };

const response = (googleStatus: string, user: Record<string, unknown> = {}, passwordCleared = false) =>
  of({ data: { access_token: 't', user: { id: 'u', email: 'a@b.c', plan: 'FREE', ...user }, googleStatus, passwordCleared } });

describe('GoogleSignInService (#618)', () => {
  let service: GoogleSignInService;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('mtc_ref', 'val');
    sessionStorage.setItem('mtc_utm', JSON.stringify({ acquisitionSource: 'instagram' }));
    TestBed.configureTestingModule({
      providers: [
        GoogleSignInService,
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: PostSignupService, useValue: postSignup },
        { provide: ToastService, useValue: toast },
      ],
    });
    service = TestBed.inject(GoogleSignInService);
  });

  afterEach(() => {
    localStorage.removeItem('mtc_ref');
    sessionStorage.removeItem('mtc_utm');
  });

  it('transmet le parrain et les UTM mémorisés avec le jeton', async () => {
    auth.googleAuth.mockReturnValue(response('login'));
    await firstValueFrom(service.signIn('jeton'));
    expect(auth.googleAuth).toHaveBeenCalledWith('jeton', 'VAL', { acquisitionSource: 'instagram' });
  });

  it('compte créé → écran de finalisation, pas encore la suite du parcours', async () => {
    auth.googleAuth.mockReturnValue(response('created', { needsSignupFinalization: true }));
    expect(await firstValueFrom(service.signIn('jeton'))).toBe('created');
    expect(router.navigate).toHaveBeenCalledWith([GOOGLE_FINALIZE_PATH]);
    expect(postSignup.afterLogin).not.toHaveBeenCalled();
  });

  it('compte e-mail relié → message au 1er passage, puis parcours de connexion', async () => {
    auth.googleAuth.mockReturnValue(response('linked'));
    await firstValueFrom(service.signIn('jeton'));
    expect(toast.success).toHaveBeenCalledWith('Ton compte Google est maintenant relié', expect.anything());
    expect(postSignup.afterLogin).toHaveBeenCalledOnce();
  });

  it('liaison avec mot de passe retiré → le message le dit et renvoie au profil', async () => {
    auth.googleAuth.mockReturnValue(response('linked', {}, true));
    await firstValueFrom(service.signIn('jeton'));
    expect(toast.success.mock.calls[0][0]).toMatch(/ancien mot de passe a été retiré/);
  });

  it('simple connexion → aucun message', async () => {
    auth.googleAuth.mockReturnValue(response('login'));
    await firstValueFrom(service.signIn('jeton'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(postSignup.afterLogin).toHaveBeenCalledOnce();
  });
});

describe('googleAuthErrorMessage', () => {
  const err = (status: number, code?: string) => new HttpErrorResponse({ status, error: code ? { code } : {} });

  it.each([
    [err(0), /réseau/],
    [err(401, 'GOOGLE_EMAIL_NOT_VERIFIED'), /pas vérifiée/],
    [err(401, 'GOOGLE_TOKEN_INVALID'), /expiré/],
    [err(403), /pas disponible pour ce compte/],
    [err(409), /autre compte Google/],
    [err(404), /indisponible/],
    [err(500), /erreur est survenue/],
  ])('%#', (e, expected) => {
    expect(googleAuthErrorMessage(e)).toMatch(expected);
  });
});
