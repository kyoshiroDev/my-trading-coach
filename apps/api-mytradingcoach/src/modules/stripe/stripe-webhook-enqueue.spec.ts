import { describe, it, expect, vi, afterEach } from 'vitest';
import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StripeWebhookService } from './stripe-webhook.service';

/**
 * la marque d'idempotence ne doit jamais survivre à un enqueue raté.
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
    {} as never, {} as never, {} as never, {} as never, queue as never, stripe as never,
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

/** #1251 : enqueue impossible : nom de l'erreur seulement dans le journal. */
describe('StripeWebhookService.handleWebhook — enqueue raté : nom de l’erreur seulement (#1251)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('erreur dont le message recopie une donnée → journal avec le nom seul', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { svc, queue } = makeSvc({ enqueueFails: true });
    queue.add.mockRejectedValue(Object.assign(new Error('READONLY client@exemple.test'), { name: 'ReplyError' }));
    await expect(svc.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toThrow();
    const lines = error.mock.calls.map((c) => String(c[0]));
    expect(lines.find((t) => t.startsWith('Enqueue impossible'))).toBe(
      `Enqueue impossible pour l'event ${EVENT.id} (${EVENT.type}) : ReplyError. Marque d'idempotence retirée → la redélivrance Stripe sera retraitée.`,
    );
    // Contre-épreuve : le message de l'erreur n'est pas recopié.
    expect(lines.join('\n')).not.toContain('client@exemple.test');
  });
});

/** #1251 : webhook rejeté : nom de l'erreur au journal, réponse fixe. */
describe('StripeWebhookService.handleWebhook — webhook rejeté sans le message de l’erreur (#1251)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('clé de configuration absente → journal avec le nom seul, réponse 400 au texte fixe', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { svc } = makeSvc();
    const config = (svc as unknown as { config: { getOrThrow: ReturnType<typeof vi.fn> } }).config;
    config.getOrThrow.mockImplementation(() => {
      throw Object.assign(new Error('Configuration key "STRIPE_WEBHOOK_SECRET" does not exist'), { name: 'TypeError' });
    });
    const rejected = await svc.handleWebhook(Buffer.from('{}'), 'sig').catch((e: unknown) => e);
    // Réponse exacte (pas une sous-chaîne) : rien du message d'origine n'est ajouté.
    expect(rejected).toBeInstanceOf(BadRequestException);
    expect((rejected as BadRequestException).message).toBe('Webhook invalide : signature invalide');
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toContain('Webhook rejeté : TypeError');
    // Contre-épreuve : le message n'est ni au journal ni dans la réponse.
    expect(lines.join('\n')).not.toContain('STRIPE_WEBHOOK_SECRET');
  });
});
