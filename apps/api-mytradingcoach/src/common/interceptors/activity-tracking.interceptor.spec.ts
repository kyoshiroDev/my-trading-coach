import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { ActivityTrackingInterceptor } from './activity-tracking.interceptor';
import { ActivityTrackingService } from '../../modules/activity-tracking/activity-tracking.service';

function contextWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
const next: CallHandler = { handle: () => of('ok') };

describe('ActivityTrackingInterceptor', () => {
  let interceptor: ActivityTrackingInterceptor;
  let markActive: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    markActive = vi.fn().mockResolvedValue(undefined);
    const service = { markActive } as unknown as ActivityTrackingService;
    interceptor = new ActivityTrackingInterceptor(service);
  });

  it('requête authentifiée (non démo) : appelle markActive avec l’userId', async () => {
    const res = await lastValueFrom(interceptor.intercept(contextWith({ id: 'user-1' }), next));
    expect(res).toBe('ok'); // la réponse passe normalement
    expect(markActive).toHaveBeenCalledWith('user-1');
  });

  it('même user deux fois : 2 appels markActive (la dédup 1 ligne/jour est dans le service/Redis)', async () => {
    await lastValueFrom(interceptor.intercept(contextWith({ id: 'user-1' }), next));
    await lastValueFrom(interceptor.intercept(contextWith({ id: 'user-1' }), next));
    expect(markActive).toHaveBeenCalledTimes(2);
  });

  it('requête non authentifiée : aucun appel', async () => {
    await lastValueFrom(interceptor.intercept(contextWith(undefined), next));
    expect(markActive).not.toHaveBeenCalled();
  });

  it('compte démo : ignoré', async () => {
    await lastValueFrom(interceptor.intercept(contextWith({ id: 'demo-1', isDemo: true }), next));
    expect(markActive).not.toHaveBeenCalled();
  });

  it('markActive qui rejette ne casse pas la requête', async () => {
    markActive.mockRejectedValue(new Error('boom'));
    const res = await lastValueFrom(interceptor.intercept(contextWith({ id: 'user-1' }), next));
    expect(res).toBe('ok');
  });
});
