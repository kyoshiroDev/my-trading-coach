import { afterEach, describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { AdminNotifier } from './admin-notifier.service';
import type { AdminPushService } from './admin-push.service';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/eAbc123-jetonSecretAbonnement';

describe('AdminNotifier · journal d’échec', () => {
  afterEach(() => vi.restoreAllMocks());

  it('nom de classe de l’erreur seulement, jamais son message (identifiant, adresse)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const deliver = vi.fn().mockRejectedValue(new TypeError(`user usr_7f3c9a2b ${ENDPOINT}`));
    new AdminNotifier({ enabled: true, deliver } as unknown as AdminPushService).notify('SIGNUP', { title: 't', body: 'b' } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(warn).toHaveBeenCalledWith('Push SIGNUP non envoyé (TypeError)');
  });
});
