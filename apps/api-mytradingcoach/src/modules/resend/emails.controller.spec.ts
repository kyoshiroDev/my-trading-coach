import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { EmailsController } from './emails.controller';
import type { EmailsService } from './emails.service';

// Désinscription (#791) : POST en un clic (client mail, RFC 8058) et GET du lien du texte, même portée.

function setup(count = 1) {
  const emails = { unsubscribe: vi.fn(async () => count) };
  const res = { type: vi.fn().mockReturnThis(), send: vi.fn() };
  return { ctrl: new EmailsController(emails as unknown as EmailsService), emails, res };
}

describe('EmailsController : désinscription', () => {
  it('POST en un clic : désinscrit avec la portée complète, sans page', async () => {
    const { ctrl, emails } = setup();
    await expect(ctrl.unsubscribeOneClick('tok', undefined as unknown as string)).resolves.toBeUndefined();
    expect(emails.unsubscribe).toHaveBeenCalledWith('tok', undefined);
  });

  it('POST scope=service : ne coupe que l’aide au démarrage', async () => {
    const { ctrl, emails } = setup();
    await ctrl.unsubscribeOneClick('tok', 'service');
    expect(emails.unsubscribe).toHaveBeenCalledWith('tok', 'service');
  });

  it('POST portée inconnue : traitée comme la désinscription complète, jamais comme service', async () => {
    const { ctrl, emails } = setup();
    await ctrl.unsubscribeOneClick('tok', 'autre');
    expect(emails.unsubscribe).toHaveBeenCalledWith('tok', undefined);
  });

  it('POST jeton inconnu : réponse neutre, sans erreur', async () => {
    const { ctrl } = setup(0);
    await expect(ctrl.unsubscribeOneClick('inconnu', undefined as unknown as string)).resolves.toBeUndefined();
  });

  it('POST : route publique, code 200 et limite de requêtes déclarés', () => {
    const handler = EmailsController.prototype.unsubscribeOneClick;
    expect(Reflect.getMetadata('method', handler)).toBe(1); // RequestMethod.POST
    expect(Reflect.getMetadata('path', handler)).toBe('unsubscribe');
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(200);
    expect(Reflect.getMetadata('isPublic', handler)).toBe(true);
    expect(Reflect.getMetadataKeys(handler).some((k: string) => String(k).startsWith('THROTTLER:LIMIT'))).toBe(true);
  });

  it('GET (anciens liens) : toujours valide, page de confirmation', async () => {
    const { ctrl, emails, res } = setup();
    await ctrl.unsubscribe('tok', 'service', res as unknown as Response);
    expect(emails.unsubscribe).toHaveBeenCalledWith('tok', 'service');
    expect(res.type).toHaveBeenCalledWith('html');
    expect(res.send.mock.calls[0][0]).toContain('Tu es désinscrit');
  });
});
