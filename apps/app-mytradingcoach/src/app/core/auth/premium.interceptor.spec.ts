import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { UserStore } from '../stores/user.store';
import { premiumInterceptor } from './premium.interceptor';

/**
 * B17 (#1013) : un 403 PREMIUM_REQUIRED (compte en cache encore vu Premium : essai fini,
 * abonnement terminé) relit le compte, pour que l'écran repasse au cadenas.
 */
describe('premiumInterceptor', () => {
  let refreshUser: ReturnType<typeof vi.fn>;
  let http: HttpClient;
  let ctrl: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    refreshUser = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([premiumInterceptor])),
        provideHttpClientTesting(),
        { provide: UserStore, useValue: { refreshUser } },
      ],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
  });

  const call = async (status: number, body: unknown) => {
    const p = firstValueFrom(http.get('/api/insights')).catch((e: unknown) => e);
    ctrl.expectOne('/api/insights').flush(body, { status, statusText: 'x' });
    return p;
  };

  it('403 PREMIUM_REQUIRED : compte relu, erreur relancée à l’appelant', async () => {
    const err = await call(403, { code: 'PREMIUM_REQUIRED', trialAvailable: false });
    expect(refreshUser).toHaveBeenCalledTimes(1);
    expect((err as { status: number }).status).toBe(403);
  });

  it('plusieurs refus d’affilée (écran à plusieurs requêtes) : une seule relecture', async () => {
    await call(403, { code: 'PREMIUM_REQUIRED' });
    await call(403, { code: 'PREMIUM_REQUIRED' });
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it('autre 403 (mode démo, accès refusé) : rien', async () => {
    await call(403, { message: 'Action non disponible en mode démo' });
    expect(refreshUser).not.toHaveBeenCalled();
  });
});
