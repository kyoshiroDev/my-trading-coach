/**
 * PROMPT-200 — régression Nath (Discord) : après un changement d'émotion sur un trade,
 * l'UI affichait « non renseignée » jusqu'au rechargement.
 *
 * `findAll()` calculait `effectiveEmotion` ; `create()` et `update()` non — ils
 * n'incluaient même pas `tradeSession`. Or `trades.store.updateTrade()` remplace l'objet
 * en store par la réponse de l'API : un champ absent n'y laisse pas l'ancienne valeur,
 * il l'écrase.
 *
 * Pourquoi une vraie base ici plutôt que le double Prisma de `trades.service.spec.ts` :
 * un double renvoie `tradeSession` quoi qu'on lui demande, donc il ne peut pas prouver
 * que l'`include` est correct — c'est-à-dire la moitié du bug. Le spec unitaire
 * contourne ça en inspectant l'argument passé à Prisma ; ici, c'est le vrai moteur qui
 * répond, donc un `include` oublié se traduit par un `moodStart` absent et le test tombe
 * de lui-même. Les deux angles se complètent, aucun ne remplace l'autre.
 *
 * On appelle `TradesService` directement : c'est là que le champ est posé. Passer par
 * HTTP n'ajouterait que l'enveloppe `{ data }`, déjà couverte ailleurs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmotionState, MoodState, SessionStatus, TradeSide, TradingSession } from '@prisma/client';
import { AppModule } from '../../app/app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { TradesService } from './trades.service';
import { CreateTradeDto } from './dto/create-trade.dto';

const PREFIX = 'int-effective-emotion-';

let app: INestApplication;
let prisma: PrismaService;
let trades: TradesService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

interface RegisterResponse {
  data: { access_token: string; user: { id: string } };
}

/** Passe par /register : il seede aussi les 6 setups par défaut, requis par `setupId`. */
async function registerUser(): Promise<{ id: string; setupId: string }> {
  const email = `${PREFIX}${uid()}@test.local`;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'int-test-no-login-1234', name: 'Int Emotion' }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  const body = (await res.json()) as RegisterResponse;
  const setup = await prisma.setup.findFirst({
    where: { userId: body.data.user.id },
    orderBy: { sortOrder: 'asc' },
  });
  if (!setup) throw new Error('Aucun setup seedé au register');
  return { id: body.data.user.id, setupId: setup.id };
}

/** Session ACTIVE : c'est elle que `create()` retrouve pour rattacher le trade. */
async function openSession(userId: string, moodStart: MoodState) {
  return prisma.tradeSession.create({
    data: { userId, status: SessionStatus.ACTIVE, moodStart, startedAt: new Date() },
  });
}

const dto = (setupId: string, emotion?: EmotionState): CreateTradeDto =>
  ({
    asset: 'MNQ',
    side: TradeSide.LONG,
    entry: 18500,
    exit: 18540,
    setupId,
    session: TradingSession.LONDON,
    timeframe: '5m',
    ...(emotion ? { emotion } : {}),
  }) as CreateTradeDto;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  await app.init();
  await app.listen(0);
  baseUrl = await app.getUrl();
  prisma = app.get(PrismaService);
  trades = app.get(TradesService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

describe('create() — émotion effective dans la réponse immédiate', () => {
  it('sans émotion sur le trade → hérite du moodStart de la session ouverte', async () => {
    const user = await registerUser();
    await openSession(user.id, MoodState.CONFIDENT);

    const created = await trades.create(user.id, dto(user.setupId));

    expect(
      created.effectiveEmotion,
      "Le champ manque ou vaut null : l'include tradeSession n'a pas chargé moodStart",
    ).toBe(MoodState.CONFIDENT);
  });

  it("l'émotion du trade prime sur le moodStart (override)", async () => {
    const user = await registerUser();
    await openSession(user.id, MoodState.NEUTRAL);

    const created = await trades.create(user.id, dto(user.setupId, EmotionState.REVENGE));

    expect(created.effectiveEmotion).toBe(EmotionState.REVENGE);
  });

  it('aucune session ouverte et aucune émotion → null, jamais un faux NEUTRAL', async () => {
    const user = await registerUser();

    const created = await trades.create(user.id, dto(user.setupId));

    expect(created.effectiveEmotion).toBeNull();
  });
});

describe('update() — émotion effective dans la réponse immédiate', () => {
  it('changer l\'émotion la renvoie aussitôt (le bug remonté par Nath)', async () => {
    const user = await registerUser();
    await openSession(user.id, MoodState.NEUTRAL);
    const created = await trades.create(user.id, dto(user.setupId));

    const updated = await trades.update(user.id, created.id, {
      emotion: EmotionState.STRESSED,
    });

    expect(
      updated.effectiveEmotion,
      "Le store remplace le trade par cette réponse : sans le champ, l'UI retombe sur « non renseignée »",
    ).toBe(EmotionState.STRESSED);
  });

  it('retirer l\'override fait retomber sur le moodStart de la session', async () => {
    const user = await registerUser();
    await openSession(user.id, MoodState.FOCUSED);
    const created = await trades.create(user.id, dto(user.setupId, EmotionState.REVENGE));
    expect(created.effectiveEmotion).toBe(EmotionState.REVENGE);

    const updated = await trades.update(user.id, created.id, { emotion: null } as never);

    expect(updated.effectiveEmotion).toBe(MoodState.FOCUSED);
  });

  it('une édition sans rapport avec l\'émotion la conserve', async () => {
    const user = await registerUser();
    await openSession(user.id, MoodState.CONFIDENT);
    const created = await trades.create(user.id, dto(user.setupId));

    const updated = await trades.update(user.id, created.id, { notes: 'note ajoutée' });

    expect(updated.effectiveEmotion).toBe(MoodState.CONFIDENT);
  });

  it('une édition qui déclenche le recalcul d\'exécution garde le champ', async () => {
    // Le bloc comportemental réécrit `result` (executionScore/Grade/Method). L'émotion
    // effective doit survivre à ce passage, et les deux coexister sur le même objet.
    const user = await registerUser();
    await openSession(user.id, MoodState.CONFIDENT);
    const created = await trades.create(user.id, dto(user.setupId));

    const updated = await trades.update(user.id, created.id, { pnl: 500 });

    expect(updated.effectiveEmotion).toBe(MoodState.CONFIDENT);
    expect(updated.pnl).toBe(500);
  });
});

describe('cohérence create/update avec findAll (même source de vérité)', () => {
  it('les trois endpoints renvoient la même émotion effective pour un trade donné', async () => {
    const user = await registerUser();
    await openSession(user.id, MoodState.TIRED);

    const created = await trades.create(user.id, dto(user.setupId));
    const updated = await trades.update(user.id, created.id, { notes: 'x' });
    const listed = await trades.findAll(user.id, {});
    const fromList = listed.data.find((t) => t.id === created.id);

    // TIRED n'existe que dans MoodState : il ne peut venir que de la session, ce qui
    // rend le test aveugle à un éventuel repli sur `trade.emotion`.
    expect(created.effectiveEmotion).toBe(MoodState.TIRED);
    expect(updated.effectiveEmotion).toBe(MoodState.TIRED);
    expect(fromList?.effectiveEmotion).toBe(MoodState.TIRED);
  });
});
