import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductEventsService } from './product-events.service';
import { ProductEventDto } from './dto/product-event.dto';
import { INSTALL_EVENTS, INSTALL_PLACES, PRODUCT_EVENTS } from './product-events.const';

describe('ProductEventsService.record', () => {
  it('upsert atomique jour × user × événement × écran', async () => {
    const prisma = { $executeRaw: vi.fn().mockResolvedValue(1) };
    await new ProductEventsService(prisma as never).record('u1', 'plan_modal_open', 'ai-insights');
    const [sql, ...values] = prisma.$executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toMatch(/ON CONFLICT \("date", "userId", "event", "place"\)/);
    expect(values).toEqual(expect.arrayContaining(['u1', 'plan_modal_open', 'ai-insights']));
  });

  it('une erreur de base ne remonte jamais à l’utilisateur', async () => {
    const prisma = { $executeRaw: vi.fn().mockRejectedValue(new Error('db down')) };
    await expect(new ProductEventsService(prisma as never).record('u1', 'trial_click')).resolves.toBeUndefined();
  });

  afterEach(() => vi.restoreAllMocks());

  it('journal sans identifiant : nom de l’erreur seulement, jamais son message', async () => {
    // Message comme ceux de Prisma : la requête et ses valeurs, dont l'identifiant du compte.
    const err = Object.assign(new Error('Invalid `prisma.$executeRaw()` invocation: userId = "cku-secret-42"'), {
      name: 'PrismaClientKnownRequestError',
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const prisma = { $executeRaw: vi.fn().mockRejectedValue(err) };

    await new ProductEventsService(prisma as never).record('cku-secret-42', 'install_shown', 'ios');

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('cku-secret-42');
    expect(logged).toContain('PrismaClientKnownRequestError');
    expect(logged).toContain('install_shown');
  });
});

describe('ProductEventDto', () => {
  const errors = (v: object) => validate(plainToInstance(ProductEventDto, v));

  it('accepte un événement de la liste blanche et un écran en minuscules', async () => {
    expect(await errors({ event: 'premium_seen', place: 'weekly-debrief' })).toHaveLength(0);
    expect(await errors({ event: 'checkout_return', place: 'canceled' })).toHaveLength(0);
  });

  it('accepte les 8 événements d’installation et les 4 plateformes, dont ios-other', async () => {
    for (const event of INSTALL_EVENTS) {
      for (const place of INSTALL_PLACES) expect(await errors({ event, place }), `${event}:${place}`).toHaveLength(0);
    }
    expect(INSTALL_EVENTS.every((e) => (PRODUCT_EVENTS as readonly string[]).includes(e))).toBe(true);
  });

  it('refuse un événement inconnu ou un écran libre (pas de donnée personnelle)', async () => {
    expect(await errors({ event: 'page_view' })).not.toHaveLength(0);
    expect(await errors({ event: 'premium_seen', place: 'Jean Dupont' })).not.toHaveLength(0);
    expect(await errors({ event: 'premium_seen', place: 'x'.repeat(41) })).not.toHaveLength(0);
  });
});
