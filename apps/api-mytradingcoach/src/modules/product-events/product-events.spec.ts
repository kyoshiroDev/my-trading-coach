import { describe, it, expect, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProductEventsService } from './product-events.service';
import { ProductEventDto } from './dto/product-event.dto';

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
});

describe('ProductEventDto', () => {
  const errors = (v: object) => validate(plainToInstance(ProductEventDto, v));

  it('accepte un événement de la liste blanche et un écran en minuscules', async () => {
    expect(await errors({ event: 'premium_seen', place: 'weekly-debrief' })).toHaveLength(0);
    expect(await errors({ event: 'checkout_return', place: 'canceled' })).toHaveLength(0);
  });

  it('refuse un événement inconnu ou un écran libre (pas de donnée personnelle)', async () => {
    expect(await errors({ event: 'page_view' })).not.toHaveLength(0);
    expect(await errors({ event: 'premium_seen', place: 'Jean Dupont' })).not.toHaveLength(0);
    expect(await errors({ event: 'premium_seen', place: 'x'.repeat(41) })).not.toHaveLength(0);
  });
});
