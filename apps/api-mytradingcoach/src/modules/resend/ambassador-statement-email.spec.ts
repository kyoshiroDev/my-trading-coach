import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ResendService } from './resend.service';
import type { RedisService } from '../infra/redis.service';

const mockSend = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: mockSend } };
  }),
}));

/**
 * #1073 : l'objet d'un e-mail est du TEXTE BRUT, jamais du HTML. Le relevé de commissions échappait
 * le nom de l'ambassadeur dans l'objet : « Martin & Co » arrivait « Martin &amp; Co » dans la boîte
 * de réception (et « O'Neil » en « O&#39;Neil » avec l'échappement complet). Le corps HTML, lui,
 * reste échappé.
 */
describe('Relevé de commissions ambassadeur : objet en texte brut (#1073)', () => {
  beforeEach(() => mockSend.mockReset().mockResolvedValue({ data: { id: 'id' }, error: null }));

  it('nom avec & et apostrophe : objet tel quel, corps HTML échappé', async () => {
    const svc = new ResendService(
      { getOrThrow: () => 're_test_key', get: () => undefined } as unknown as ConfigService,
      { client: { incr: vi.fn(), expire: vi.fn() } } as unknown as RedisService,
      { add: vi.fn() } as never,
    );
    await svc.sendAmbassadorStatement({
      ambassadorName: `O'Neil & Co <x>`,
      ambassadorEmail: 'amb@test.local',
      period: '2026-10',
      pdf: Buffer.from('pdf'),
    });
    const mail = mockSend.mock.calls[0][0] as { subject: string; html: string };
    expect(mail.subject).toBe(`Relevé de commissions · O'Neil & Co <x> (2026-10)`);
    expect(mail.html).toContain('O&#39;Neil &amp; Co &lt;x&gt;'); // échappement unique, 5 caractères
    expect(mail.html).not.toContain('<x>');
  });
});
