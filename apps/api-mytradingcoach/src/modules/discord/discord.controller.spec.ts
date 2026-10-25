import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptor';
import { UsersService } from '../users/users.service';
import { DiscordController } from './discord.controller';
import { DiscordLinkService } from './discord-link.service';
import { DiscordService } from './discord.service';

/** Remplace JwtAuthGuard : la requête porte toujours l'utilisateur `alice`. */
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().user = { id: 'alice' };
    return true;
  }
}

/** Corps d'une réponse emballée par le ResponseInterceptor (`{ data }`). */
const dataOf = async (r: Response) => ((await r.json()) as { data: Record<string, unknown> }).data;

const SECRET = 'bot-secret-test';
const DISCORD_ID = '111111111111111111';

// UsersService et DiscordService sont fournis pour que l'ancien contrôleur (qui les injectait)
// se construise aussi : la contre-épreuve échoue sur ses assertions, pas sur le câblage.
const users = {
  findByEmail: vi.fn(async (email: string) => (email === 'alice@test.com' ? { id: 'alice', email, name: 'Alice', plan: 'PREMIUM', role: 'USER', trialEndsAt: null } : null)),
  updateDiscordId: vi.fn(),
};
const discord = { syncDiscordRole: vi.fn() };
const link = {
  status: vi.fn(async () => ({ linked: false })),
  createCode: vi.fn(async () => ({ code: 'ABCD-EFGH', expiresAt: '2026-10-25T10:10:00.000Z' })),
  redeem: vi.fn(),
};

describe('DiscordController (#741)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    process.env['DISCORD_BOT_SECRET'] = SECRET;
    const moduleRef = await Test.createTestingModule({
      controllers: [DiscordController],
      providers: [
        { provide: DiscordLinkService, useValue: link },
        { provide: UsersService, useValue: users },
        { provide: DiscordService, useValue: discord },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => vi.clearAllMocks());

  const verifyByEmail = (email: string) =>
    fetch(`${base}/api/discord/verify?email=${encodeURIComponent(email)}&discordId=${DISCORD_ID}`, {
      headers: { 'x-discord-secret': SECRET },
    });

  it('GET /verify par e-mail : ne lit pas la base, ne relie rien, ne donne aucun nom', async () => {
    const res = await verifyByEmail('alice@test.com');
    expect(res.status).toBe(200);
    const body = await dataOf(res);
    expect(body['verified']).toBe(false);
    expect(JSON.stringify(body)).not.toContain('Alice');
    expect(users.findByEmail).not.toHaveBeenCalled();
    expect(users.updateDiscordId).not.toHaveBeenCalled();
    expect(discord.syncDiscordRole).not.toHaveBeenCalled();
  });

  it('GET /verify : même réponse, que l’adresse existe ou non', async () => {
    const known = await (await verifyByEmail('alice@test.com')).json();
    const unknown = await (await verifyByEmail('personne@test.com')).json();
    expect(known).toEqual(unknown);
  });

  it('secret du bot absent ou faux → 401, sur /verify comme sur /link', async () => {
    expect((await fetch(`${base}/api/discord/verify?email=a@b.c&discordId=${DISCORD_ID}`)).status).toBe(401);
    const res = await fetch(`${base}/api/discord/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-discord-secret': 'faux' },
      body: JSON.stringify({ code: 'ABCD-EFGH', discordId: DISCORD_ID }),
    });
    expect(res.status).toBe(401);
    expect(link.redeem).not.toHaveBeenCalled();
  });

  const postLink = (body: object) =>
    fetch(`${base}/api/discord/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-discord-secret': SECRET },
      body: JSON.stringify(body),
    });

  it('POST /link, code bon → relié avec le plan, sans nom ni e-mail', async () => {
    link.redeem.mockResolvedValue({ status: 'linked', premium: true });
    const res = await postLink({ code: 'abcd-efgh', discordId: DISCORD_ID });
    expect(res.status).toBe(200);
    expect(await dataOf(res)).toEqual({ linked: true, plan: 'PREMIUM' });
    expect(link.redeem).toHaveBeenCalledWith('abcd-efgh', DISCORD_ID);
  });

  it('POST /link, code invalide et limite atteinte → 200 avec un message, jamais d’autre détail', async () => {
    link.redeem.mockResolvedValue({ status: 'invalid' });
    const invalid = await dataOf(await postLink({ code: 'ZZZZ-ZZZZ', discordId: DISCORD_ID }));
    expect(invalid['linked']).toBe(false);
    expect(invalid['message']).toMatch(/Code invalide ou expiré/);
    link.redeem.mockResolvedValue({ status: 'rate_limited' });
    const limited = await dataOf(await postLink({ code: 'ZZZZ-ZZZZ', discordId: DISCORD_ID }));
    expect(limited['message']).toMatch(/Trop d'essais/);
  });

  it('POST /link : identifiant Discord mal formé ou champ en trop → 400', async () => {
    expect((await postLink({ code: 'ABCD-EFGH', discordId: 'abc' })).status).toBe(400);
    expect((await postLink({ code: 'ABCD-EFGH', discordId: DISCORD_ID, email: 'a@b.c' })).status).toBe(400);
    expect(link.redeem).not.toHaveBeenCalled();
  });

  it('POST /link-code → code pour l’utilisateur connecté ; GET /link → état', async () => {
    const created = await fetch(`${base}/api/discord/link-code`, { method: 'POST' });
    expect(created.status).toBe(201);
    expect(await dataOf(created)).toEqual({ code: 'ABCD-EFGH', expiresAt: '2026-10-25T10:10:00.000Z' });
    expect(link.createCode).toHaveBeenCalledWith('alice');
    const status = await fetch(`${base}/api/discord/link`);
    expect(await dataOf(status)).toEqual({ linked: false });
    expect(link.status).toHaveBeenCalledWith('alice');
  });
});
