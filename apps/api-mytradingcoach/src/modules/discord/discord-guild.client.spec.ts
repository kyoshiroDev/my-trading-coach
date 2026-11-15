import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordGuildClient } from './discord-guild.client';

// N2 (#1046) : `call()` ne regardait jamais `res.ok` et avalait les erreurs réseau. setPlanRole ne
// levait donc jamais : fin d'essai comptée « rôle Discord en échec : 0 » et rôle Premium resté.
const ENV = {
  DISCORD_GUILD_ID: 'g1', DISCORD_BOT_TOKEN: 'bot', DISCORD_ROLE_PREMIUM_ID: 'rp', DISCORD_ROLE_MEMBRE_ID: 'rm',
};

describe('DiscordGuildClient', () => {
  const fetchMock = vi.fn();
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    vi.unstubAllGlobals();
  });

  const res = (status: number) => ({ ok: status >= 200 && status < 300, status });

  describe('setPlanRole', () => {
    it('Discord répond 2xx : aucun échec', async () => {
      fetchMock.mockResolvedValue(res(204));
      await expect(new DiscordGuildClient().setPlanRole('d1', false)).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('Discord répond 429 ou 5xx : l’échec remonte (compté par l’appelant)', async () => {
      fetchMock.mockResolvedValueOnce(res(204)).mockResolvedValueOnce(res(429));
      await expect(new DiscordGuildClient().setPlanRole('d1', false)).rejects.toThrow('HTTP 429');
    });

    it('panne réseau ou délai dépassé : l’échec remonte', async () => {
      fetchMock.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
      await expect(new DiscordGuildClient().setPlanRole('d1', true)).rejects.toThrow();
    });

    it('404 (membre parti du serveur) : pas un échec', async () => {
      fetchMock.mockResolvedValue(res(404));
      await expect(new DiscordGuildClient().setPlanRole('d1', true)).resolves.toBeUndefined();
    });
  });

  describe('removePlanRoles', () => {
    it('ne lève jamais (suppression de compte), mais dit si les rôles sont bien retirés', async () => {
      fetchMock.mockResolvedValue(res(204));
      await expect(new DiscordGuildClient().removePlanRoles('d1')).resolves.toBe(true);
      fetchMock.mockResolvedValue(res(503));
      await expect(new DiscordGuildClient().removePlanRoles('d1')).resolves.toBe(false);
      fetchMock.mockRejectedValue(new Error('réseau'));
      await expect(new DiscordGuildClient().removePlanRoles('d1')).resolves.toBe(false);
    });
  });
});
