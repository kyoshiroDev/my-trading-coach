import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ResendService } from './resend.service';

const mockSend = vi.fn().mockResolvedValue({ data: { id: 'email-id' }, error: null });

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function () {
    return {
      emails: { send: mockSend },
    };
  }),
}));

describe('ResendService', () => {
  let service: ResendService;

  beforeEach(async () => {
    mockSend.mockClear();

    const module = await Test.createTestingModule({
      providers: [
        ResendService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn().mockReturnValue('re_test_key'),
            get: vi.fn().mockImplementation((key: string) => {
              if (key === 'MAIL_FROM') return 'noreply@mytradingcoach.app';
              if (key === 'MAIL_SAV') return 'hello@mytradingcoach.app';
              if (key === 'FRONTEND_URL') return 'https://app.mytradingcoach.app';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get(ResendService);
  });

  describe('sendDebriefReady', () => {
    it('envoie un email avec le bon sujet et les stats', async () => {
      await service.sendDebriefReady({
        to: 'trader@test.com',
        userName: 'Greg',
        weekNumber: 17,
        winRate: 65.5,
        totalPnl: 234.5,
        totalTrades: 12,
      });

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe('trader@test.com');
      expect(call.subject).toContain('17');
      expect(call.html).toContain('65.5');
      expect(call.html).toContain('234.50');
    });

    it('ne throw pas si Resend retourne une erreur', async () => {
      mockSend.mockResolvedValueOnce({ data: null, error: { message: 'API error' } });

      await expect(
        service.sendDebriefReady({
          to: 'trader@test.com',
          userName: 'Greg',
          weekNumber: 17,
          winRate: 50,
          totalPnl: 0,
          totalTrades: 5,
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('sendRenewalReminder', () => {
    it("envoie un email avec la date d'expiration", async () => {
      const expiresAt = new Date('2026-05-01');

      await service.sendRenewalReminder({
        to: 'trader@test.com',
        userName: 'Greg',
        expiresAt,
      });

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.subject).toContain('7 jours');
      expect(call.html).toContain('2026');
    });

    it('ne throw pas si Resend retourne une erreur', async () => {
      mockSend.mockResolvedValueOnce({ data: null, error: { message: 'API error' } });

      await expect(
        service.sendRenewalReminder({
          to: 'trader@test.com',
          userName: 'Greg',
          expiresAt: new Date(),
        }),
      ).resolves.not.toThrow();
    });
  });
});
