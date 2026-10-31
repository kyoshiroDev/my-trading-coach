import { describe, it, expect, vi } from 'vitest';
import { EmailsService } from './emails.service';

function setup(count = 1) {
  const prisma = { user: { updateMany: vi.fn(async () => ({ count })) } };
  return { service: new EmailsService(prisma as never), prisma };
}

describe('EmailsService.unsubscribe', () => {
  it('retire le consentement marketing ET coupe les e-mails de service du user porteur du token', async () => {
    const { service, prisma } = setup(1);
    await expect(service.unsubscribe('tok-123')).resolves.toBe(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { unsubToken: 'tok-123' },
      data: { serviceEmailsOptOutAt: expect.any(Date) },
    });
    // #747 : la date du consentement est gardée (preuve), le retrait est daté, seulement s'il y avait consentement.
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { unsubToken: 'tok-123', marketingConsent: true },
      data: { marketingConsent: false, marketingConsentWithdrawnAt: expect.any(Date) },
    });
    const writes = prisma.user.updateMany.mock.calls.map((c) => JSON.stringify(c));
    expect(writes.some((w) => w.includes('"marketingConsentAt"'))).toBe(false);
  });

  it('portée service : coupe seulement les conseils de prise en main, garde le consentement marketing', async () => {
    const { service, prisma } = setup(1);
    await expect(service.unsubscribe('tok-123', 'service')).resolves.toBe(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { unsubToken: 'tok-123' },
      data: { serviceEmailsOptOutAt: expect.any(Date) },
    });
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('token absent : aucune écriture', async () => {
    const { service, prisma } = setup();
    await expect(service.unsubscribe(undefined)).resolves.toBe(0);
    await expect(service.unsubscribe('')).resolves.toBe(0);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('token inconnu : 0 ligne, sans erreur', async () => {
    const { service, prisma } = setup(0);
    await expect(service.unsubscribe('inconnu')).resolves.toBe(0);
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1);
  });
});
