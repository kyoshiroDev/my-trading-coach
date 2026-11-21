import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadGatewayException, BadRequestException, ConflictException } from '@nestjs/common';
import { freezeClock } from '../../test/freeze-clock';
import { GiveawayInstagramService, INSTAGRAM_TOKEN_RE } from './giveaway-instagram.service';
import { MetricoolClient, MetricoolError } from './metricool.client';
import { checkCaption, fallbackCaption, instagramImageHtml, periodLabel, prizeLabel } from './giveaway-instagram.template';

/** Lot C du tirage mensuel : publication Instagram d'un gagnant. Aucun vrai appel IA ni Metricool. */
const NOW = new Date('2027-02-10T10:00:00Z');
freezeClock(NOW);

const FACTS = { displayName: 'Léa M.', instagramHandle: 'lea.trade', pool: 'FREE' as const, prizeMonths: 1, periodLabel: 'février 2027' };

describe('gabarit et légende', () => {
  it('libellés', () => {
    expect(periodLabel('2027-02')).toBe('février 2027');
    expect(prizeLabel('FREE', 1)).toBe('1\u00a0mois de Premium offert');
    expect(prizeLabel('PREMIUM', 3)).toBe('3\u00a0mois d’abonnement offerts');
  });

  it('image : nom, lot et mois ; nom échappé', () => {
    const html = instagramImageHtml({ ...FACTS, displayName: '<script>x</script>' });
    expect(html).toContain('février 2027');
    expect(html).toContain('1\u00a0mois de Premium offert');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('width:1080px;height:1350px');
  });

  it('légende de repli : vraies données, mention du pseudo Instagram, conforme', () => {
    const c = fallbackCaption(FACTS);
    expect(c).toContain('@lea.trade');
    expect(c).toContain('février 2027');
    expect(checkCaption(c).problems).toEqual([]);
  });

  it('contrôle : prix et promesse refusés, tirets remplacés, 5 hashtags au plus', () => {
    expect(checkCaption('Gagne 49 € de Premium').problems).toContain('prix');
    expect(checkCaption('Avec MTC tu vas devenir rentable').problems.length).toBeGreaterThan(0);
    const { caption } = checkCaption('Bravo \u2014 Léa #a #b #c #d #e #f #g');
    expect(caption).not.toMatch(/[\u2014–]/);
    expect(caption.match(/#/g)).toHaveLength(5);
  });
});

describe('GiveawayInstagramService', () => {
  const win = (over: Record<string, unknown> = {}) => ({
    id: 'w1', userId: 'u1', instagramConsent: true, message: null, moderation: 'EN_ATTENTE', activationStatus: 'APPLIED',
    displayConsent: 'PRENOM_INITIALE', displayPseudo: null, instagramHandle: 'lea.trade', pool: 'FREE', prizeMonths: 1,
    draw: { period: '2027-02' }, user: { name: 'Léa Martin' }, ...over,
  });
  let current: Record<string, unknown> | null;
  const prisma = { giveawayWin: { findUnique: vi.fn(async () => current), update: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({})), updateMany: vi.fn(async (_args: { where: unknown; data: Record<string, unknown> }) => ({ count: 1 })) } };
  const store = new Map<string, string>();
  const redis = { client: { get: vi.fn(async (k: string) => store.get(k) ?? null), set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }) } };
  const anthropic = { enabled: true, create: vi.fn() };
  const pdf = { renderPng: vi.fn(async () => Buffer.from('PNG')) };
  const metricool = { configured: true, publishInstagram: vi.fn(async () => ({ postId: '42', publicUrl: 'https://instagram.com/p/x' })) };
  const config = { get: vi.fn((k: string): string | undefined => (k === 'API_URL' ? 'https://dev.api.test' : undefined)) };
  const service = new GiveawayInstagramService(prisma as never, redis as never, anthropic as never, pdf as never, metricool as never, config as never);
  const aiText = (text: string) => ({ content: [{ type: 'text', text }], usage: {} });

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    current = win();
    anthropic.enabled = true;
    metricool.configured = true;
    config.get.mockImplementation((k: string) => (k === 'API_URL' ? 'https://dev.api.test' : undefined));
  });

  it('aperçu : légende IA (prompt mis en cache, coût via AnthropicClientService) et image temporaire', async () => {
    anthropic.create.mockResolvedValueOnce(aiText('Bravo @lea.trade, qui gagne 1 mois de Premium sur MyTradingCoach. Chaque mois, un tirage parmi les traders qui enregistrent leurs trades. #trading'));
    const p = await service.preview('w1');
    expect(p.aiGenerated).toBe(true);
    expect(p.caption).toContain('@lea.trade');
    expect(p.metricoolAvailable).toBe(true);
    const params = anthropic.create.mock.calls[0][0];
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(anthropic.create.mock.calls[0][1]).toEqual({ feature: 'giveaway_instagram', userId: null });
    expect(p.imageUrl).toMatch(/^https:\/\/dev\.api\.test\/api\/public\/giveaway\/image\/[a-f0-9]{48}\.png$/);
    const token = p.imageUrl.split('/').pop()!.replace('.png', '');
    expect(INSTAGRAM_TOKEN_RE.test(token)).toBe(true);
    expect((await service.image(token))?.toString()).toBe('PNG');
    expect(redis.client.set).toHaveBeenCalledWith(expect.stringContaining(token), expect.any(String), 'EX', 86400);
  });

  it('sortie IA non conforme (prix) : légende de repli, rien ne casse', async () => {
    anthropic.create.mockResolvedValue(aiText('Gagne 49 € de Premium !'));
    const p = await service.preview('w1');
    expect(p.aiGenerated).toBe(false);
    expect(p.caption).toBe(fallbackCaption({ ...FACTS, displayName: 'Léa M.' }));
  });

  it('IA coupée ou en erreur : légende de repli', async () => {
    anthropic.enabled = false;
    expect((await service.preview('w1')).aiGenerated).toBe(false);
    anthropic.enabled = true;
    anthropic.create.mockRejectedValueOnce(Object.assign(new Error('overloaded'), { name: 'APIError' }));
    expect((await service.preview('w1')).aiGenerated).toBe(false);
  });

  it('sans accord Instagram, message non validé ou lot non attribué : refusé', async () => {
    current = win({ instagramConsent: false });
    await expect(service.preview('w1')).rejects.toBeInstanceOf(ConflictException);
    current = win({ message: 'Merci', moderation: 'EN_ATTENTE' });
    await expect(service.preview('w1')).rejects.toBeInstanceOf(ConflictException);
    current = win({ activationStatus: 'FAILED' });
    await expect(service.preview('w1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('publication : Metricool appelé, statut et lien enregistrés', async () => {
    anthropic.enabled = false;
    const { imageUrl, caption } = await service.preview('w1');
    const r = await service.publish('w1', { caption, imageUrl });
    expect(metricool.publishInstagram).toHaveBeenCalledWith({ caption, imageUrl, publishAt: null });
    expect(r).toMatchObject({ publicationStatus: 'PUBLISHED', publishedUrl: 'https://instagram.com/p/x' });
    // Réservation atomique avant l'envoi, puis lien enregistré.
    expect(prisma.giveawayWin.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'w1', publicationStatus: { not: 'PUBLISHED' } }, data: { publicationStatus: 'PUBLISHED' } });
    expect(prisma.giveawayWin.update.mock.calls[0][0].data).toEqual({ publishedUrl: 'https://instagram.com/p/x' });
  });

  it('publication refusée : sans Metricool, légende interdite, image étrangère, date passée', async () => {
    anthropic.enabled = false;
    const { imageUrl, caption } = await service.preview('w1');
    metricool.configured = false;
    await expect(service.publish('w1', { caption, imageUrl })).rejects.toBeInstanceOf(ConflictException);
    metricool.configured = true;
    await expect(service.publish('w1', { caption: 'Gagne 49 €', imageUrl })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.publish('w1', { caption, imageUrl: 'https://ailleurs.test/x.png' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.publish('w1', { caption, imageUrl, publishAt: '2027-01-01T00:00:00Z' })).rejects.toBeInstanceOf(BadRequestException);
    expect(metricool.publishInstagram).not.toHaveBeenCalled();
  });

  it('Metricool refuse (abonnement) : FAILED enregistré, message de repli', async () => {
    anthropic.enabled = false;
    const { imageUrl, caption } = await service.preview('w1');
    metricool.publishInstagram.mockRejectedValueOnce(new MetricoolError(403, 'Metricool : accès refusé (abonnement ou jeton).'));
    await expect(service.publish('w1', { caption, imageUrl })).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.giveawayWin.update.mock.calls[0][0].data).toEqual({ publicationStatus: 'FAILED', publishedAt: null });
  });

  it('post parti mais lien non enregistré : reste PUBLISHED, jamais redescendu à FAILED', async () => {
    anthropic.enabled = false;
    const { imageUrl, caption } = await service.preview('w1');
    metricool.publishInstagram.mockResolvedValueOnce({ postId: '9', publicUrl: 'https://instagram.com/p/y' });
    prisma.giveawayWin.update.mockRejectedValueOnce(new Error('db'));
    await expect(service.publish('w1', { caption, imageUrl })).resolves.toMatchObject({ publicationStatus: 'PUBLISHED' });
    expect(prisma.giveawayWin.update).toHaveBeenCalledTimes(1);
  });

  it('déjà publié : 409 sans appel Metricool (aperçu et publication) ; course perdue : 409 aussi', async () => {
    anthropic.enabled = false;
    const { imageUrl, caption } = await service.preview('w1');
    current = win({ publicationStatus: 'PUBLISHED' });
    await expect(service.preview('w1')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.publish('w1', { caption, imageUrl })).rejects.toBeInstanceOf(ConflictException);
    current = win();
    prisma.giveawayWin.updateMany.mockResolvedValueOnce({ count: 0 }); // l'autre onglet a réservé d'abord
    await expect(service.publish('w1', { caption, imageUrl })).rejects.toBeInstanceOf(ConflictException);
    expect(metricool.publishInstagram).not.toHaveBeenCalled();
    expect(prisma.giveawayWin.update).not.toHaveBeenCalled(); // jamais redescendu à FAILED
  });

  it('sans API_URL hors prod : erreur claire plutôt qu’une image introuvable', async () => {
    config.get.mockImplementation((k: string) => (k === 'FRONTEND_URL' ? 'https://dev.app.test' : undefined));
    anthropic.enabled = false;
    await expect(service.preview('w1')).rejects.toThrow(/API_URL manquante/);
  });

  it('image : jeton invalide ou expiré → null', async () => {
    expect(await service.image('../etc')).toBeNull();
    expect(await service.image('a'.repeat(48))).toBeNull();
  });
});

describe('MetricoolClient', () => {
  const env: Record<string, string | undefined> = {};
  const client = new MetricoolClient({ get: (k: string) => env[k] } as never);
  const fetchMock = vi.fn();

  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sans les trois variables : non configuré, aucun appel', async () => {
    env['METRICOOL_API_TOKEN'] = 't';
    expect(client.configured).toBe(false);
    await expect(client.publishInstagram({ caption: 'x', imageUrl: 'https://i' })).rejects.toBeInstanceOf(MetricoolError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('publication : image copiée chez Metricool puis post Instagram auto-publié', async () => {
    Object.assign(env, { METRICOOL_API_TOKEN: 'tok', METRICOOL_USER_ID: '1', METRICOOL_BLOG_ID: '2' });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify('https://cdn.metricool.test/img.png'), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 99 } }), { status: 200 }));
    const r = await client.publishInstagram({ caption: 'Bravo', imageUrl: 'https://api.test/i.png' });
    expect(r).toEqual({ postId: '99', publicUrl: null });
    expect(fetchMock.mock.calls[0][0]).toContain('/actions/normalize/image/url?');
    expect(fetchMock.mock.calls[0][1].headers['X-Mc-Auth']).toBe('tok');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({ text: 'Bravo', autoPublish: true, providers: [{ network: 'instagram' }], media: ['https://cdn.metricool.test/img.png'] });
    expect(body.publicationDate.timezone).toBe('Europe/Paris');
  });

  it('refus 403 : erreur lisible, jamais le corps brut', async () => {
    Object.assign(env, { METRICOOL_API_TOKEN: 'tok', METRICOOL_USER_ID: '1', METRICOOL_BLOG_ID: '2' });
    fetchMock.mockResolvedValueOnce(new Response('{"secret":"x"}', { status: 403 }));
    await expect(client.publishInstagram({ caption: 'x', imageUrl: 'https://i' })).rejects.toThrow('accès refusé (abonnement ou jeton)');
  });
});
