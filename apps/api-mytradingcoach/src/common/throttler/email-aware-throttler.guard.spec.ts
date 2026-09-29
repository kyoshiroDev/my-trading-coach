import { EmailAwareThrottlerGuard } from './email-aware-throttler.guard';

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
