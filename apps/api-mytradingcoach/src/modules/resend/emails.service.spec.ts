import { describe, it, expect, vi } from 'vitest';
import { EmailsService } from './emails.service';

function setup(count = 1) {
  const prisma = { user: { updateMany: vi.fn(async () => ({ count })) } };
  return { service: new EmailsService(prisma as never), prisma };
}

describe('EmailsService.unsubscribe', () => {
  it('retire le consentement marketing du user porteur du token', async () => {
    const { service, prisma } = setup(1);
    await expect(service.unsubscribe('tok-123')).resolves.toBe(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { unsubToken: 'tok-123' },
      data: { marketingConsent: false, marketingConsentAt: null },
    });
  });

  it('token absent : aucune écriture', async () => {
    const { service, prisma } = setup();
    await expect(service.unsubscribe(undefined)).resolves.toBe(0);
    await expect(service.unsubscribe('')).resolves.toBe(0);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('token inconnu : 0 ligne, sans erreur', async () => {
    const { service } = setup(0);
    await expect(service.unsubscribe('inconnu')).resolves.toBe(0);
  });
});
