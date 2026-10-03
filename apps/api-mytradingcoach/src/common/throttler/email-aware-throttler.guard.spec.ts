import { vi } from 'vitest';
import { EmailAwareThrottlerGuard, IP_THROTTLER, IP_THROTTLER_OFF, defaultThrottleLimit, USER_THROTTLE_LIMIT, ANON_THROTTLE_LIMIT } from './email-aware-throttler.guard';

/**
 * Le rate limiting des routes d'authentification doit compter par IP **et** par compte visé.
 *
 * Les deux défauts que ça corrige, dans les deux sens : plusieurs personnes derrière un même NAT
 * se bloquaient mutuellement ; et une attaque distribuée sur un seul compte obtenait la limite
 * entière depuis chaque IP sans jamais la déclencher.
 */
describe('EmailAwareThrottlerGuard — clé de comptage', () => {
  /** `getTracker` est protégée : c'est le comportement qu'on verrouille, pas la signature. */
  const tracker = (req: Record<string, unknown>): Promise<string> =>
    (
      new EmailAwareThrottlerGuard({ throttlers: [] }, {} as never, {} as never) as unknown as {
        getTracker: (r: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker(req);

  it('sans email → la clé reste l’IP, comportement inchangé', async () => {
    await expect(tracker({ ip: '10.0.0.1' })).resolves.toBe('10.0.0.1');
    await expect(tracker({ ip: '10.0.0.1', body: {} })).resolves.toBe('10.0.0.1');
    await expect(tracker({ ip: '10.0.0.1', body: null })).resolves.toBe('10.0.0.1');
  });

  it('avec email → la clé distingue les comptes d’une même IP', async () => {
    const a = await tracker({ ip: '10.0.0.1', body: { email: 'a@example.com' } });
    const b = await tracker({ ip: '10.0.0.1', body: { email: 'b@example.com' } });
    expect(a).not.toBe(b);
    // Deux personnes derrière le même NAT ne se bloquent plus l'une l'autre.
    expect(a.startsWith('10.0.0.1:')).toBe(true);
  });

  it('même compte depuis deux IP → deux clés, mais le compte reste identifiable', async () => {
    const ici = await tracker({ ip: '10.0.0.1', body: { email: 'a@example.com' } });
    const ailleurs = await tracker({ ip: '10.0.0.2', body: { email: 'a@example.com' } });
    expect(ici).not.toBe(ailleurs);
    expect(ici.split(':')[1]).toBe(ailleurs.split(':')[1]); // même empreinte de compte
  });

  it('casse et espaces normalisés : la limite ne se contourne pas en changeant la casse', async () => {
    const attendu = await tracker({ ip: '10.0.0.1', body: { email: 'greg@mail.com' } });
    for (const variante of ['  greg@mail.com ', 'Greg@Mail.com', 'GREG@MAIL.COM']) {
      await expect(tracker({ ip: '10.0.0.1', body: { email: variante } })).resolves.toBe(attendu);
    }
  });

  it('l’email n’apparaît jamais en clair dans la clé', async () => {
    // La clé part dans Redis : un compteur n'a pas besoin de connaître l'adresse.
    const cle = await tracker({ ip: '10.0.0.1', body: { email: 'greg@mail.com' } });
    expect(cle).not.toContain('greg');
    expect(cle).not.toContain('@');
    expect(cle).toMatch(/^10\.0\.0\.1:[0-9a-f]{16}$/);
  });

  it('email non textuel (tableau injecté) → ignoré, aucune exception', async () => {
    // Corps d'entrée non fiable : un tableau ou un objet ne doit pas casser le comptage.
    await expect(tracker({ ip: '10.0.0.1', body: { email: ['a@b.c'] } })).resolves.toBe('10.0.0.1');
    await expect(tracker({ ip: '10.0.0.1', body: { email: 42 } })).resolves.toBe('10.0.0.1');
  });
});

describe('EmailAwareThrottlerGuard — throttler « ip » (SCA-B0-04)', () => {
  type Props = { throttler: { name: string }; limit: number; getTracker: (r: Record<string, unknown>) => Promise<string> };
  const guard = new EmailAwareThrottlerGuard({ throttlers: [] }, {} as never, {} as never) as unknown as {
    handleRequest: (p: Props) => Promise<boolean>;
  };
  const parent = Object.getPrototypeOf(EmailAwareThrottlerGuard.prototype) as { handleRequest: (p: Props) => Promise<boolean> };

  it('route sans limite par IP : rien n’est compté (aucun aller-retour Redis)', async () => {
    const spy = vi.spyOn(parent, 'handleRequest');
    await expect(
      guard.handleRequest({ throttler: { name: IP_THROTTLER }, limit: IP_THROTTLER_OFF, getTracker: vi.fn() }),
    ).resolves.toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('route limitée par IP : compte sur l’IP seule, même avec un e-mail dans le corps', async () => {
    const spy = vi.spyOn(parent, 'handleRequest').mockResolvedValue(true);
    await guard.handleRequest({ throttler: { name: IP_THROTTLER }, limit: 10, getTracker: vi.fn() });
    const passed = spy.mock.calls[0][0];
    await expect(passed.getTracker({ ip: '10.0.0.1', body: { email: 'a@example.com' } })).resolves.toBe('10.0.0.1');
    spy.mockRestore();
  });

  it('throttler par défaut : inchangé (clé IP + compte)', async () => {
    const spy = vi.spyOn(parent, 'handleRequest').mockResolvedValue(true);
    const getTracker = vi.fn();
    await guard.handleRequest({ throttler: { name: 'default' }, limit: 5, getTracker });
    expect(spy.mock.calls[0][0].getTracker).toBe(getTracker);
    spy.mockRestore();
  });
});

describe('SCA-B3-03 — compteur par utilisateur une fois connecté', () => {
  const tracker = (req: Record<string, unknown>) =>
    (
      new EmailAwareThrottlerGuard({} as never, {} as never, {} as never) as unknown as {
        getTracker: (r: Record<string, unknown>) => Promise<string>;
      }
    ).getTracker(req);

  it('connecté → user:<id>, quelle que soit l’IP', async () => {
    expect(await tracker({ ip: '1.2.3.4', user: { id: 'u1' }, headers: {} })).toBe('user:u1');
    expect(await tracker({ ip: '9.9.9.9', user: { id: 'u1' }, headers: {} })).toBe('user:u1');
  });

  it('anonyme → IP (inchangé)', async () => {
    expect(await tracker({ ip: '1.2.3.4', headers: {} })).toBe('1.2.3.4');
  });

  it('limite par défaut : 300 connecté, 60 anonyme', () => {
    const ctx = (user?: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;
    expect(defaultThrottleLimit(ctx({ id: 'u1' }))).toBe(USER_THROTTLE_LIMIT);
    expect(defaultThrottleLimit(ctx(undefined))).toBe(ANON_THROTTLE_LIMIT);
    expect([USER_THROTTLE_LIMIT, ANON_THROTTLE_LIMIT]).toEqual([300, 60]);
  });
});
