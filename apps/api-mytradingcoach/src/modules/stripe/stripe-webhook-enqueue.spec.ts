import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * PROMPT-185 #1 — la marque d'idempotence ne doit jamais survivre à un enqueue raté.
 *
 * `handleWebhook` pose la marque (insert unique = verrou anti-course) AVANT
 * d'enfiler le job. Si l'enqueue échoue (Redis indisponible), la marque doit être
 * retirée : sinon Stripe redélivre, l'event est vu « déjà traité », et il n'est
 * JAMAIS exécuté — un client paie et reste FREE, sans trace.
 */

const EVENT = { id: 'evt_test_1', type: 'invoice.payment_succeeded' };

function makeSvc(opts: { enqueueFails?: boolean } = {}) {
  const stripeEvent = {
    create: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  };
  const prisma = { stripeEvent };
  const queue = {
    add: opts.enqueueFails
      ? vi.fn().mockRejectedValue(new Error('Redis indisponible'))
      : vi.fn().mockResolvedValue({}),
  };
  const config = { getOrThrow: vi.fn(() => 'whsec_fake') };

  // Signature validée : ce test porte sur l'ordre marque/enqueue, pas sur la crypto.
  const stripe = { webhooks: { constructEvent: vi.fn(() => EVENT) } };

  const svc = new StripeWebhookService(
    config as never, prisma as never, {} as never, {} as never,
    {} as never, {} as never, queue as never, stripe as never,
  );
  return { svc, stripeEvent, queue };
}

describe('StripeWebhookService.handleWebhook — idempotence vs enqueue', () => {
  it('enqueue OK → event marqué traité, job enfilé', async () => {
    const { svc, stripeEvent, queue } = makeSvc();

    const res = await svc.handleWebhook(Buffer.from('{}'), 'sig');

    expect(res).toEqual({ received: true });
    expect(stripeEvent.create).toHaveBeenCalledWith({
      data: { id: EVENT.id, type: EVENT.type },
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
    // Rien à compenser quand tout va bien.
    expect(stripeEvent.delete).not.toHaveBeenCalled();
  });

  it('enqueue KO → marque retiree (compensation) ET erreur relancee vers Stripe', async () => {
    const { svc, stripeEvent, queue } = makeSvc({ enqueueFails: true });

    await expect(
      svc.handleWebhook(Buffer.from('{}'), 'sig'),
      "L'erreur doit remonter pour que Stripe reçoive un 5xx et redélivre",
    ).rejects.toThrow('Redis indisponible');

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(
      stripeEvent.delete,
      'Sans compensation, la redélivrance serait ignorée et le paiement perdu',
    ).toHaveBeenCalledWith({ where: { id: EVENT.id } });
  });

  it('apres compensation, la redelivrance du meme event est bien retraitee', async () => {
    const { svc, stripeEvent, queue } = makeSvc({ enqueueFails: true });
    await expect(svc.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow();

    // 2e livraison : la marque a été retirée, donc l'insert repasse (pas de P2002)
    // et l'enqueue est retenté — cette fois avec Redis revenu.
    queue.add.mockResolvedValue({});
    const res = await svc.handleWebhook(Buffer.from('{}'), 'sig');

    expect(res).toEqual({ received: true });
    expect(stripeEvent.create).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('event deja traite avec succes → toujours ignore (idempotence preservee)', async () => {
    const { svc, stripeEvent, queue } = makeSvc();
    // Prisma renvoie une violation d'unicité : l'event a déjà été enfilé.
    stripeEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const res = await svc.handleWebhook(Buffer.from('{}'), 'sig');

    expect(res).toEqual({ received: true });
    expect(queue.add, 'Un event déjà traité ne doit pas être ré-enfilé').not.toHaveBeenCalled();
    expect(stripeEvent.delete, 'Rien à compenser : la marque appartient au 1er passage').not.toHaveBeenCalled();
  });
});