import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RedisService } from '../infra/redis.service';
import type { DiscordGuildClient } from './discord-guild.client';
import {
  DISCORD_CODE_ALPHABET,
  DISCORD_CODE_TTL_S,
  DISCORD_UNLINK_FAILED_MESSAGE,
  DiscordLinkService,
  REDEEM_LIMIT_PER_HOUR,
  REDEEM_LIMIT_PER_MINUTE,
  normalizeDiscordCode,
} from './discord-link.service';

/** Redis en mémoire avec expirations sur une horloge manuelle : get, set (EX, NX), del, getdel, multi. */
function fakeRedis() {
  let now = 0;
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const read = (k: string) => {
    const e = store.get(k);
    if (e && e.expiresAt !== null && e.expiresAt <= now) store.delete(k);
    return store.get(k)?.value ?? null;
  };
  const set = (k: string, v: string, ...args: (string | number)[]) => {
    const nx = args.includes('NX');
    if (nx && read(k) !== null) return null;
    const ex = args.indexOf('EX');
    store.set(k, { value: v, expiresAt: ex >= 0 ? now + Number(args[ex + 1]) * 1000 : null });
    return 'OK';
  };
  const incr = (k: string) => {
    const next = Number(read(k) ?? 0) + 1;
    const e = store.get(k);
    store.set(k, { value: String(next), expiresAt: e?.expiresAt ?? null });
    return next;
  };
  const client = {
    get: vi.fn(async (k: string) => read(k)),
    set: vi.fn(async (k: string, v: string, ...a: (string | number)[]) => set(k, v, ...a)),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
    getdel: vi.fn(async (k: string) => {
      const v = read(k);
      store.delete(k);
      return v;
    }),
    multi: vi.fn(() => {
      const ops: (() => unknown)[] = [];
      const chain = {
        set: (k: string, v: string, ...a: (string | number)[]) => { ops.push(() => set(k, v, ...a)); return chain; },
        incr: (k: string) => { ops.push(() => incr(k)); return chain; },
        exec: async () => ops.map((o) => [null, o()]),
      };
      return chain;
    }),
  };
  return {
    redis: { client } as unknown as RedisService,
    client,
    advance: (seconds: number) => { now += seconds * 1000; },
  };
}

/** Base en mémoire : `id → { discordId, plan, role, trialEndsAt }`, contrainte d'unicité sur discordId. */
function fakePrisma(users: Record<string, { discordId: string | null; plan?: string; role?: string }>) {
  const rows = new Map(
    Object.entries(users).map(([id, u]) => [id, { plan: 'FREE', role: 'USER', trialEndsAt: null as Date | null, ...u }]),
  );
  const user = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const r = rows.get(where.id);
      return r ? { ...r } : null;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { discordId: string; id?: string; NOT?: { id: string } }; data: { discordId: null } }) => {
      let count = 0;
      for (const [id, r] of rows) {
        const idOk = where.id !== undefined ? id === where.id : id !== where.NOT?.id;
        if (r.discordId === where.discordId && idOk) { r.discordId = data.discordId; count++; }
      }
      return { count };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { discordId: string } }) => {
      for (const [id, r] of rows) {
        if (id !== where.id && r.discordId === data.discordId) throw new Error('Unique constraint failed on discordId');
      }
      rows.get(where.id)!.discordId = data.discordId;
      return rows.get(where.id);
    }),
  };
  const prisma = { user, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ user })) };
  return { prisma: prisma as unknown as PrismaService, rows };
}

const DISCORD_A = '111111111111111111';
const DISCORD_B = '222222222222222222';

describe('DiscordLinkService (#741)', () => {
  let r: ReturnType<typeof fakeRedis>;
  let db: ReturnType<typeof fakePrisma>;
  let guild: {
    setPlanRole: ReturnType<typeof vi.fn>;
    removePlanRoles: ReturnType<typeof vi.fn>;
    tryRemovePlanRoles: ReturnType<typeof vi.fn>;
  };
  let service: DiscordLinkService;

  const build = (users: Parameters<typeof fakePrisma>[0]) => {
    db = fakePrisma(users);
    service = new DiscordLinkService(db.prisma, r.redis, guild as unknown as DiscordGuildClient);
  };

  beforeEach(() => {
    r = fakeRedis();
    guild = {
      setPlanRole: vi.fn(async () => undefined),
      removePlanRoles: vi.fn(async () => undefined),
      tryRemovePlanRoles: vi.fn(async () => true),
    };
    build({ alice: { discordId: null }, bob: { discordId: null } });
  });

  it('code de 8 signes de l’alphabet de Crockford, affiché « XXXX-XXXX », valable 10 min', async () => {
    const { code, expiresAt } = await service.createCode('alice', Date.parse('2026-10-25T10:00:00Z'));
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect([...code.replace('-', '')].every((c) => DISCORD_CODE_ALPHABET.includes(c))).toBe(true);
    expect(expiresAt).toBe('2026-10-25T10:10:00.000Z');
  });

  it('code valide → relie CE compte au Discord qui l’a tapé, rôle du plan posé', async () => {
    const { code } = await service.createCode('alice');
    await expect(service.redeem(code, DISCORD_A)).resolves.toEqual({ status: 'linked', premium: false });
    expect(db.rows.get('alice')!.discordId).toBe(DISCORD_A);
    expect(db.rows.get('bob')!.discordId).toBeNull();
    expect(guild.setPlanRole).toHaveBeenCalledWith(DISCORD_A, false);
  });

  it('Premium → rôle Premium', async () => {
    build({ alice: { discordId: null, plan: 'PREMIUM' } });
    const { code } = await service.createCode('alice');
    await expect(service.redeem(code, DISCORD_A)).resolves.toEqual({ status: 'linked', premium: true });
    expect(guild.setPlanRole).toHaveBeenCalledWith(DISCORD_A, true);
  });

  it('saisie tolérante : minuscules, espace au lieu du tiret, O pour 0, I ou L pour 1', () => {
    expect(normalizeDiscordCode('ab0d efgh')).toBe('AB0DEFGH');
    expect(normalizeDiscordCode('abOd-efgh')).toBe('AB0DEFGH');
    expect(normalizeDiscordCode('a1i1-L1gh')).toBe('A11111GH');
    expect(normalizeDiscordCode('ABCD-EFG')).toBeNull();
    expect(normalizeDiscordCode('ABCD-EFGU')).toBeNull(); // U hors alphabet
  });

  it('code expiré → invalide, rien n’est relié', async () => {
    const { code } = await service.createCode('alice');
    r.advance(DISCORD_CODE_TTL_S + 1);
    await expect(service.redeem(code, DISCORD_A)).resolves.toEqual({ status: 'invalid' });
    expect(db.rows.get('alice')!.discordId).toBeNull();
    expect(guild.setPlanRole).not.toHaveBeenCalled();
  });

  it('code réutilisé → la 2e fois est invalide, même pour un autre Discord', async () => {
    const { code } = await service.createCode('alice');
    await service.redeem(code, DISCORD_A);
    await expect(service.redeem(code, DISCORD_B)).resolves.toEqual({ status: 'invalid' });
    expect(db.rows.get('alice')!.discordId).toBe(DISCORD_A);
  });

  it('code inconnu, expiré et réutilisé : exactement la même réponse', async () => {
    const unknown = await service.redeem('ZZZZ-ZZZZ', DISCORD_B);
    const { code: c1 } = await service.createCode('alice');
    r.advance(DISCORD_CODE_TTL_S + 1);
    const expired = await service.redeem(c1, DISCORD_B);
    const { code: c2 } = await service.createCode('alice');
    await service.redeem(c2, DISCORD_A);
    const reused = await service.redeem(c2, DISCORD_B);
    expect(expired).toEqual(unknown);
    expect(reused).toEqual(unknown);
  });

  it('un nouveau code invalide le précédent du même compte', async () => {
    const { code: first } = await service.createCode('alice');
    const { code: second } = await service.createCode('alice');
    await expect(service.redeem(first, DISCORD_A)).resolves.toEqual({ status: 'invalid' });
    await expect(service.redeem(second, DISCORD_A)).resolves.toEqual({ status: 'linked', premium: false });
  });

  it('mauvais compte : le code de Bob relie Bob, jamais le compte dont le Discord tape le code', async () => {
    build({ alice: { discordId: DISCORD_A }, bob: { discordId: null } });
    const { code } = await service.createCode('bob');
    await service.redeem(code, DISCORD_B);
    expect(db.rows.get('bob')!.discordId).toBe(DISCORD_B);
    expect(db.rows.get('alice')!.discordId).toBe(DISCORD_A);
  });

  it('ancien Discord du compte détaché : ses rôles sont retirés', async () => {
    build({ alice: { discordId: DISCORD_A } });
    const { code } = await service.createCode('alice');
    await service.redeem(code, DISCORD_B);
    expect(db.rows.get('alice')!.discordId).toBe(DISCORD_B);
    expect(guild.removePlanRoles).toHaveBeenCalledWith(DISCORD_A);
    expect(guild.setPlanRole).toHaveBeenCalledWith(DISCORD_B, false);
  });

  it('même Discord relié de nouveau : aucun rôle retiré', async () => {
    build({ alice: { discordId: DISCORD_A } });
    const { code } = await service.createCode('alice');
    await service.redeem(code, DISCORD_A);
    expect(guild.removePlanRoles).not.toHaveBeenCalled();
  });

  it('Discord déjà relié à un autre compte : détaché de l’autre compte, sans erreur d’unicité', async () => {
    build({ alice: { discordId: DISCORD_A }, bob: { discordId: null } });
    const { code } = await service.createCode('bob');
    await expect(service.redeem(code, DISCORD_A)).resolves.toEqual({ status: 'linked', premium: false });
    expect(db.rows.get('alice')!.discordId).toBeNull();
    expect(db.rows.get('bob')!.discordId).toBe(DISCORD_A);
  });

  it('compte supprimé entre la génération et la saisie → invalide', async () => {
    const { code } = await service.createCode('alice');
    db.rows.delete('alice');
    await expect(service.redeem(code, DISCORD_A)).resolves.toEqual({ status: 'invalid' });
    expect(guild.setPlanRole).not.toHaveBeenCalled();
  });

  it(`limite par minute : au-delà de ${REDEEM_LIMIT_PER_MINUTE} essais, refusé même avec un bon code`, async () => {
    for (let i = 0; i < REDEEM_LIMIT_PER_MINUTE; i++) {
      await expect(service.redeem('ZZZZ-ZZZZ', DISCORD_B)).resolves.toEqual({ status: 'invalid' });
    }
    const { code } = await service.createCode('alice');
    await expect(service.redeem(code, DISCORD_B)).resolves.toEqual({ status: 'rate_limited' });
    expect(db.rows.get('alice')!.discordId).toBeNull();
    // Le code n'a pas été consommé : utilisable une fois la minute passée.
    r.advance(61);
    await expect(service.redeem(code, DISCORD_B)).resolves.toEqual({ status: 'linked', premium: false });
  });

  it(`limite par heure : au-delà de ${REDEEM_LIMIT_PER_HOUR} essais sur l’heure, refusé`, async () => {
    for (let i = 0; i < REDEEM_LIMIT_PER_HOUR; i++) {
      await service.redeem('ZZZZ-ZZZZ', DISCORD_B);
      r.advance(61); // jamais plus de 1 essai par minute
    }
    await expect(service.redeem('ZZZZ-ZZZZ', DISCORD_B)).resolves.toEqual({ status: 'rate_limited' });
    r.advance(3600);
    await expect(service.redeem('ZZZZ-ZZZZ', DISCORD_B)).resolves.toEqual({ status: 'invalid' });
  });

  it('la limite est propre à chaque identifiant Discord', async () => {
    for (let i = 0; i <= REDEEM_LIMIT_PER_MINUTE; i++) await service.redeem('ZZZZ-ZZZZ', DISCORD_B);
    await expect(service.redeem('ZZZZ-ZZZZ', DISCORD_B)).resolves.toEqual({ status: 'rate_limited' });
    await expect(service.redeem('ZZZZ-ZZZZ', DISCORD_A)).resolves.toEqual({ status: 'invalid' });
  });

  it('status : relié ou non, sans jamais rendre l’identifiant Discord', async () => {
    build({ alice: { discordId: DISCORD_A }, bob: { discordId: null } });
    await expect(service.status('alice')).resolves.toEqual({ linked: true });
    await expect(service.status('bob')).resolves.toEqual({ linked: false });
  });

  describe('unlink : délier son Discord', () => {
    it('relié → rôles retirés sur le serveur, liaison effacée, état « non relié »', async () => {
      build({ alice: { discordId: DISCORD_A } });
      await expect(service.unlink('alice')).resolves.toEqual({ linked: false });
      expect(guild.tryRemovePlanRoles).toHaveBeenCalledWith(DISCORD_A);
      expect(db.rows.get('alice')!.discordId).toBeNull();
      await expect(service.status('alice')).resolves.toEqual({ linked: false });
    });

    it('contre-épreuve : retrait du rôle échoué → 503 avec un message clair, liaison gardée', async () => {
      build({ alice: { discordId: DISCORD_A } });
      guild.tryRemovePlanRoles.mockResolvedValue(false);
      const err = await service.unlink('alice').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as Error).message).toBe(DISCORD_UNLINK_FAILED_MESSAGE);
      expect(DISCORD_UNLINK_FAILED_MESSAGE).not.toContain(DISCORD_A);
      expect(db.rows.get('alice')!.discordId).toBe(DISCORD_A);
    });

    it('rien de relié → aucun appel à Discord', async () => {
      await expect(service.unlink('alice')).resolves.toEqual({ linked: false });
      expect(guild.tryRemovePlanRoles).not.toHaveBeenCalled();
    });

    it('n’efface que le compte qui délie, pas les autres', async () => {
      build({ alice: { discordId: DISCORD_A }, bob: { discordId: DISCORD_B } });
      await service.unlink('alice');
      expect(db.rows.get('bob')!.discordId).toBe(DISCORD_B);
    });

    it('autre Discord relié pendant le retrait des rôles → la nouvelle liaison n’est pas effacée', async () => {
      build({ alice: { discordId: DISCORD_A } });
      guild.tryRemovePlanRoles.mockImplementation(async () => {
        db.rows.get('alice')!.discordId = DISCORD_B;
        return true;
      });
      await service.unlink('alice');
      expect(db.rows.get('alice')!.discordId).toBe(DISCORD_B);
    });
  });
});
