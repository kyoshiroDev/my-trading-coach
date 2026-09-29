import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { DeprecatedRoute, DeprecatedRouteInterceptor } from './deprecated-route.decorator';

class LegacyController {
  @DeprecatedRoute('GET /admin/users/stats')
  stats() {
    return 'ok';
  }
}

describe('DeprecatedRoute', () => {
  it('journalise un warn avec la route de remplacement, puis laisse passer la requête', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const interceptor = new DeprecatedRouteInterceptor(new Reflector());
    const context = {
      getHandler: () => LegacyController.prototype.stats,
      switchToHttp: () => ({ getRequest: () => ({ method: 'GET', path: '/api/users/admin/stats' }) }),
    } as never;

    const result = await new Promise((resolve) =>
      interceptor.intercept(context, { handle: () => of('ok') }).subscribe(resolve),
    );

    expect(result).toBe('ok');
    expect(warn).toHaveBeenCalledWith(
      'Route obsolète appelée : GET /api/users/admin/stats → utiliser GET /admin/users/stats',
    );
    warn.mockRestore();
  });
});
