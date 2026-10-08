import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { getQueueToken } from '@nestjs/bullmq';
import { ResendService, RESEND_DAILY_WARN, maskEmail } from './resend.service';
import { RedisService } from '../infra/redis.service';
import { EMAIL_JOB_OPTIONS, EMAIL_QUEUE, RetryableEmailError } from './email-queue';

vi.mock('@sentry/nestjs', () => ({ captureMessage: vi.fn() }));

const redisClient = { incr: vi.fn(), expire: vi.fn() };
const emailQueue = { add: vi.fn() };

const mockSend = vi
  .fn()
  .mockResolvedValue({ data: { id: 'email-id' }, error: null });

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
    mockSend.mockResolvedValue({ data: { id: 'email-id' }, error: null });
    vi.mocked(Sentry.captureMessage).mockClear();
    redisClient.incr.mockReset().mockResolvedValue(1);
    redisClient.expire.mockReset().mockResolvedValue(1);
    // Par défaut la file est « en panne » : send() retombe sur l'envoi direct, ce qui permet aux
    // tests des templates de vérifier le contenu passé à Resend. La file est testée à part.
    emailQueue.add.mockReset().mockRejectedValue(new Error('file indisponible'));

    const module = await Test.createTestingModule({
      providers: [
        ResendService,
        { provide: RedisService, useValue: { client: redisClient } },
        { provide: getQueueToken(EMAIL_QUEUE), useValue: emailQueue },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: vi.fn().mockReturnValue('re_test_key'),
            get: vi.fn().mockImplementation((key: string) => {
              if (key === 'MAIL_FROM') return 'noreply@mytradingcoach.app';
              if (key === 'MAIL_SAV') return 'hello@mytradingcoach.app';
              if (key === 'FRONTEND_URL')
                return 'https://app.mytradingcoach.app';
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
        currency: 'USD',
      });

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe('trader@test.com');
      expect(call.subject).toContain('17');
      expect(call.html).toContain('65.5');
      // Devise du compte, sans conversion.
      expect(call.html).toContain('+$235');
    });

    it('ne throw pas si Resend retourne une erreur', async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: 'API error' },
      });

      await expect(
        service.sendDebriefReady({
          to: 'trader@test.com',
          userName: 'Greg',
          weekNumber: 17,
          winRate: 50,
          totalPnl: 0,
          totalTrades: 5,
          currency: 'USD',
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
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: 'API error' },
      });

      await expect(
        service.sendRenewalReminder({
          to: 'trader@test.com',
          userName: 'Greg',
          expiresAt: new Date(),
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('send : mise en file (SCA-B5-02)', () => {
    it('met l’e-mail en file avec 5 essais, sans appeler Resend', async () => {
      emailQueue.add.mockResolvedValue({ id: '1' });

      await service.send({ to: 'a@test.com', subject: 's', html: 'h' });

      expect(emailQueue.add).toHaveBeenCalledWith('send', { to: 'a@test.com', subject: 's', html: 'h' }, EMAIL_JOB_OPTIONS);
      expect(EMAIL_JOB_OPTIONS.attempts).toBe(5);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('file indisponible → envoi direct, l’e-mail n’est pas perdu', async () => {
      await expect(service.send({ to: 'a@test.com', subject: 's', html: 'h' })).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledOnce();
    });
  });

  describe('deliver depuis la file (SCA-B5-02)', () => {
    const err = (name: string) => ({ data: null, error: { name, message: name, statusCode: 429 } });
    const params = { to: 'a@test.com', subject: 's', html: 'h' };

    it('passe la clé d’idempotence du job à Resend', async () => {
      await service.deliver(params, { lastAttempt: false, idempotencyKey: 'email/42' });

      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@test.com' }), { idempotencyKey: 'email/42' });
    });

    it.each(['rate_limit_exceeded', 'application_error', 'internal_server_error'])(
      '%s avant le dernier essai → RetryableEmailError, un seul appel, pas de Sentry',
      async (name) => {
        mockSend.mockResolvedValue(err(name));

        await expect(service.deliver(params, { lastAttempt: false, idempotencyKey: 'k' })).rejects.toBeInstanceOf(RetryableEmailError);
        expect(mockSend).toHaveBeenCalledOnce();
        expect(Sentry.captureMessage).not.toHaveBeenCalled();
      },
    );

    it('erreur passagère au dernier essai → abandon signalé à Sentry, sans lever', async () => {
      mockSend.mockResolvedValue(err('rate_limit_exceeded'));

      await expect(service.deliver(params, { lastAttempt: true, idempotencyKey: 'k' })).resolves.toBeUndefined();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Resend : rate_limit_exceeded',
        expect.objectContaining({ fingerprint: ['resend-send-failed', 'rate_limit_exceeded'] }),
      );
    });

    it('quota atteint → pas de nouvel essai même avant le dernier, Sentry en fatal', async () => {
      mockSend.mockResolvedValue(err('daily_quota_exceeded'));

      await expect(service.deliver(params, { lastAttempt: false, idempotencyKey: 'k' })).resolves.toBeUndefined();
      expect(Sentry.captureMessage).toHaveBeenCalledWith('Resend : daily_quota_exceeded', expect.objectContaining({ level: 'fatal' }));
    });

    it('exception du SDK (réseau) → traitée comme passagère', async () => {
      mockSend.mockRejectedValue(new Error('fetch failed'));

      await expect(service.deliver(params, { lastAttempt: false, idempotencyKey: 'k' })).rejects.toMatchObject({
        resendError: 'application_error',
      });
    });
  });

  describe('deliver direct : débit, quotas et volume (2026-10-01)', () => {
    const err = (name: string) => ({ data: null, error: { name, message: name, statusCode: 429 } });
    const noWait = () => vi.spyOn(service as unknown as { sleep: (ms: number) => Promise<void> }, 'sleep').mockResolvedValue();

    it('rate_limit_exceeded → réessaie puis envoie, sans alerte Sentry', async () => {
      const sleep = noWait();
      mockSend.mockResolvedValueOnce(err('rate_limit_exceeded')).mockResolvedValueOnce(err('rate_limit_exceeded'));

      await service.deliver({ to: 'a@test.com', subject: 's', html: 'h' });

      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(redisClient.incr).toHaveBeenCalledOnce();
    });

    it('débit toujours dépassé après 3 essais → abandon signalé à Sentry', async () => {
      noWait();
      mockSend.mockResolvedValue(err('rate_limit_exceeded'));

      await service.deliver({ to: 'a@test.com', subject: 's', html: 'h' });

      expect(mockSend).toHaveBeenCalledTimes(4);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'Resend : rate_limit_exceeded',
        expect.objectContaining({ level: 'error', fingerprint: ['resend-send-failed', 'rate_limit_exceeded'] }),
      );
    });

    it('quota journalier dépassé → pas de nouvel essai, Sentry en fatal, regroupé', async () => {
      mockSend.mockResolvedValue(err('daily_quota_exceeded'));

      await service.deliver({ to: 'a@test.com', subject: 's', html: 'h' });
      await service.deliver({ to: 'b@test.com', subject: 's', html: 'h' });

      expect(mockSend).toHaveBeenCalledTimes(2);
      const calls = vi.mocked(Sentry.captureMessage).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][1]).toMatchObject({ level: 'fatal', fingerprint: ['resend-send-failed', 'daily_quota_exceeded'] });
      expect(calls[1][1]).toMatchObject({ fingerprint: ['resend-send-failed', 'daily_quota_exceeded'] }); // même issue
      expect(redisClient.incr).not.toHaveBeenCalled();
    });

    it(`prévient Sentry une seule fois, au ${RESEND_DAILY_WARN}e envoi du jour`, async () => {
      redisClient.incr.mockResolvedValueOnce(RESEND_DAILY_WARN - 1).mockResolvedValueOnce(RESEND_DAILY_WARN).mockResolvedValueOnce(RESEND_DAILY_WARN + 1);

      for (let i = 0; i < 3; i++) await service.deliver({ to: 'a@test.com', subject: 's', html: 'h' });

      expect(Sentry.captureMessage).toHaveBeenCalledOnce();
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining(`${RESEND_DAILY_WARN} e-mails`),
        expect.objectContaining({ level: 'error', fingerprint: ['resend-daily-volume'] }), // 'warning' = priorité moyenne = pas d'e-mail
      );
      expect(redisClient.incr.mock.calls[0][0]).toMatch(/^resend:sent:\d{4}-\d{2}-\d{2}$/);
    });

    it('Redis en panne → l’e-mail part quand même', async () => {
      redisClient.incr.mockRejectedValue(new Error('Stream isn\'t writeable'));

      await expect(service.deliver({ to: 'a@test.com', subject: 's', html: 'h' })).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledOnce();
    });

    it('maskEmail garde le domaine, cache l’adresse', () => {
      expect(maskEmail('jean.dupont@gmail.com')).toBe('j***@gmail.com');
      expect(maskEmail('invalide')).toBe('***');
    });
  });
});
