import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { DiscordService } from './discord.service';
import { PrismaService } from '../../prisma/prisma.service';

const mockFetch = vi.fn().mockResolvedValue({ ok: true });
vi.stubGlobal('fetch', mockFetch);

const mockPrisma = {
  user: { findUnique: vi.fn() },
};

describe('DiscordService', () => {
  let service: DiscordService;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env['DISCORD_GUILD_ID'] = 'guild-123';
    process.env['DISCORD_BOT_TOKEN'] = 'bot-token';
    process.env['DISCORD_ROLE_PREMIUM_ID'] = 'role-premium';
    process.env['DISCORD_ROLE_MEMBRE_ID'] = 'role-membre';

    const module = await Test.createTestingModule({
      providers: [DiscordService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get(DiscordService);
  });

  it('user sans discordId → skip sans appel fetch', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ discordId: null, plan: 'FREE', role: 'USER', trialEndsAt: null });
    await service.syncDiscordRole('user-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('user inexistant → skip sans appel fetch', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await service.syncDiscordRole('user-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('USER FREE → appelle PUT avec rôle MEMBRE', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ discordId: 'discord-123', plan: 'FREE', role: 'USER', trialEndsAt: null });
    await service.syncDiscordRole('user-1');
    const putCall = mockFetch.mock.calls.find(([url, opts]) => opts?.method === 'PUT' && url.includes('role-membre'));
    expect(putCall).toBeDefined();
  });

  it('USER PREMIUM → appelle PUT avec rôle PREMIUM', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ discordId: 'discord-123', plan: 'PREMIUM', role: 'USER', trialEndsAt: null });
    await service.syncDiscordRole('user-1');
    const putCall = mockFetch.mock.calls.find(([url, opts]) => opts?.method === 'PUT' && url.includes('role-premium'));
    expect(putCall).toBeDefined();
  });

  it('BETA_TESTER → traité comme PREMIUM', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ discordId: 'discord-123', plan: 'FREE', role: 'BETA_TESTER', trialEndsAt: null });
    await service.syncDiscordRole('user-1');
    const putCall = mockFetch.mock.calls.find(([url, opts]) => opts?.method === 'PUT' && url.includes('role-premium'));
    expect(putCall).toBeDefined();
  });

  it('env vars manquantes → skip sans appel fetch', async () => {
    delete process.env['DISCORD_GUILD_ID'];
    mockPrisma.user.findUnique.mockResolvedValue({ discordId: 'discord-123', plan: 'PREMIUM', role: 'USER', trialEndsAt: null });
    await service.syncDiscordRole('user-1');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
