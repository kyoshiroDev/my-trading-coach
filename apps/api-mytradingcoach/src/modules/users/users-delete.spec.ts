import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { BILLING_CLOSURE_FAILED_MESSAGE, UsersService } from './users.service';
import { AmbassadorService } from '../ambassador/ambassador.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../infra/redis.service';
import { StripeAccountClosureService } from '../stripe/stripe-account-closure.service';
import { DiscordGuildClient } from '../discord/discord-guild.client';

const baseUser = {
  role: 'USER',
  name: 'Kevin',
  email: 'kevin@test.com',
  plan: 'FREE',
  createdAt: new Date(Date.now() - 4 * 86_400_000), // 4 jours
  referredBy: 'VAL',
  stripeCustomerId: null as string | null,
  _count: { trades: 0 },
};

const mockPrisma = {
  user: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
  deletedAccount: { create: vi.fn().mockReturnValue({ __op: 'create' }) },
  $transaction: vi.fn().mockResolvedValue([{}, {}]),
};

const mockRedis = { client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } };

const billingClosure = { cancelAllSubscriptions: vi.fn() };

const discordGuild = { removePlanRoles: vi.fn(async () => undefined) };

describe('UsersService — suppression + trace DeletedAccount', () => {
  let service: UsersService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser });
    mockPrisma.deletedAccount.create.mockReturnValue({ __op: 'create' });
    mockPrisma.user.delete.mockReturnValue({ __op: 'delete' });
    mockPrisma.$transaction.mockResolvedValue([{}, {}]);
    billingClosure.cancelAllSubscriptions.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisService, useValue: mockRedis },
        // setRole délègue à AmbassadorService pour garantir le referralCode
        // d'un AMBASSADOR ; non sollicité par ces tests.
        { provide: AmbassadorService, useValue: { promote: vi.fn(), revoke: vi.fn() } },
        { provide: StripeAccountClosureService, useValue: billingClosure },
        { provide: DiscordGuildClient, useValue: discordGuild },
      ],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('deleteMe archive une trace puis supprime, dans une transaction', async () => {
    await service.deleteMe('user-1', 'Trop compliqué');

    expect(mockPrisma.deletedAccount.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.deletedAccount.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: 'Kevin', email: 'kevin@test.com', plan: 'FREE',
      hadTraded: false, tradesCount: 0, referredBy: 'VAL',
      deletedBy: 'self', reason: 'Trop compliqué',
    });
    expect(data.lifetimeDays).toBeGreaterThanOrEqual(3);
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    // create ET delete passés ensemble à $transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it('Discord relié (#741) : ses rôles sont retirés, APRÈS la suppression du User', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, discordId: '111111111111111111' });
    await service.deleteMe('user-1');
    expect(discordGuild.removePlanRoles).toHaveBeenCalledWith('111111111111111111');
    expect(mockPrisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      discordGuild.removePlanRoles.mock.invocationCallOrder[0],
    );
  });

  it('sans Discord relié : aucun appel Discord', async () => {
    await service.deleteMe('user-1');
    expect(discordGuild.removePlanRoles).not.toHaveBeenCalled();
  });

  it('compte interne (#823) : recopié dans la trace ; compte normal : false', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isInternal: true });
    await service.deleteMe('user-1');
    expect(mockPrisma.deletedAccount.create.mock.calls[0][0].data.isInternal).toBe(true);

    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, isInternal: false });
    await service.adminDelete('user-1');
    expect(mockPrisma.deletedAccount.create.mock.calls[1][0].data.isInternal).toBe(false);
    expect(mockPrisma.user.findUnique.mock.calls[0][0].select.isInternal).toBe(true);
  });

  it('reason vide → null', async () => {
    await service.deleteMe('user-1', '   ');
    expect(mockPrisma.deletedAccount.create.mock.calls[0][0].data.reason).toBeNull();
  });

  it('hadTraded true quand l’utilisateur a des trades', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, _count: { trades: 7 } });
    await service.deleteMe('user-1');
    const data = mockPrisma.deletedAccount.create.mock.calls[0][0].data;
    expect(data.hadTraded).toBe(true);
    expect(data.tradesCount).toBe(7);
    expect(data.deletedBy).toBe('self');
  });

  it('adminDelete trace avec deletedBy=admin', async () => {
    await service.adminDelete('user-1');
    expect(mockPrisma.deletedAccount.create.mock.calls[0][0].data.deletedBy).toBe('admin');
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('adminDelete refuse de supprimer un ADMIN (aucune trace, aucune suppression)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, role: 'ADMIN' });
    await expect(service.adminDelete('admin-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(mockPrisma.deletedAccount.create).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  describe('résiliation Stripe avant suppression', () => {
    it('sans client Stripe : aucun appel Stripe, suppression normale', async () => {
      await service.deleteMe('user-1');
      expect(billingClosure.cancelAllSubscriptions).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it.each(['active', 'trialing', 'past_due'])(
      'abonnement %s : résilié AVANT la suppression du User',
      async (status) => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, plan: 'PREMIUM', stripeCustomerId: 'cus_1' });
        billingClosure.cancelAllSubscriptions.mockResolvedValue([`sub_${status}`]);

        await service.deleteMe('user-1');

        expect(billingClosure.cancelAllSubscriptions).toHaveBeenCalledWith('cus_1');
        expect(billingClosure.cancelAllSubscriptions.mock.invocationCallOrder[0]).toBeLessThan(
          mockPrisma.$transaction.mock.invocationCallOrder[0],
        );
        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      },
    );

    it('client Stripe sans abonnement en cours : suppression normale', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, stripeCustomerId: 'cus_1' });
      await service.deleteMe('user-1');
      expect(billingClosure.cancelAllSubscriptions).toHaveBeenCalledWith('cus_1');
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('Stripe échoue : 503 au message clair, aucune trace ni suppression', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, plan: 'PREMIUM', stripeCustomerId: 'cus_1' });
      billingClosure.cancelAllSubscriptions.mockRejectedValue(new Error('Stripe API indisponible'));

      const err = await service.deleteMe('user-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as ServiceUnavailableException).message).toBe(BILLING_CLOSURE_FAILED_MESSAGE);
      // Adresse publique du support, jamais l'adresse interne hello@.
      expect(BILLING_CLOSURE_FAILED_MESSAGE).toContain('support@mytradingcoach.app');
      expect(BILLING_CLOSURE_FAILED_MESSAGE).not.toContain('hello@');
      expect(mockPrisma.deletedAccount.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.delete).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    // Résiliation acquise, puis échec de la transaction : le compte reste, SANS abonnement
    // (customer.subscription.deleted le repasse ensuite en FREE, cf. stripe-webhook.service.spec).
    // L'erreur d'origine remonte (500 générique), pas le 503 « résiliation échouée », qui serait faux.
    it('Stripe résilie puis la base échoue : erreur d’origine, compte conservé, nouvel essai possible', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, plan: 'PREMIUM', stripeCustomerId: 'cus_1' });
      billingClosure.cancelAllSubscriptions.mockResolvedValueOnce(['sub_active']);
      const dbDown = new Error('connexion Postgres perdue');
      mockPrisma.$transaction.mockRejectedValueOnce(dbDown);

      await expect(service.deleteMe('user-1')).rejects.toBe(dbDown);
      expect(billingClosure.cancelAllSubscriptions).toHaveBeenCalledTimes(1);

      // Nouvel essai : plus rien à résilier chez Stripe, la suppression aboutit.
      billingClosure.cancelAllSubscriptions.mockResolvedValueOnce([]);
      await expect(service.deleteMe('user-1')).resolves.toBeUndefined();
      expect(billingClosure.cancelAllSubscriptions).toHaveBeenCalledTimes(2);
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('adminDelete résilie aussi : même flux', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...baseUser, plan: 'PREMIUM', stripeCustomerId: 'cus_9' });
      await service.adminDelete('user-1');
      expect(billingClosure.cancelAllSubscriptions).toHaveBeenCalledWith('cus_9');
    });
  });
});
