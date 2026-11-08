import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AiService } from './ai.service';
import { AI_TEXT_FALLBACK } from '../../common/ai-text-guard/ai-text-guard';

/**
 * Garde-fou branché sur les sorties de l'IA (#881) : chat, insights, récap du jour, débrief. Le
 * modèle est un double (AUCUN appel réel) qui renvoie d'abord un texte non conforme.
 */

const text = (t: string) => ({ content: [{ type: 'text', text: t }] });

function makeService() {
  const anthropic = { create: vi.fn() };
  const orchestrator = { runInsightsFlow: vi.fn() };
  const debriefAgent = { generate: vi.fn() };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(null) },
    trade: { findMany: vi.fn().mockResolvedValue([]) },
    tradingAccount: { count: vi.fn().mockResolvedValue(1) },
  };
  const redis = { client: { get: vi.fn().mockResolvedValue(null), incr: vi.fn().mockResolvedValue(1), expire: vi.fn(), decr: vi.fn() } };
  const svc = new AiService(prisma as never, orchestrator as never, debriefAgent as never, anthropic as never, redis as never);
  return { svc, anthropic, orchestrator, debriefAgent };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('garde-fou de sortie de l’IA', () => {
  it('chat : réponse non conforme régénérée une fois', async () => {
    const { svc, anthropic } = makeService();
    anthropic.create.mockResolvedValueOnce(text("Achète MNQ, c'est ton edge.")).mockResolvedValueOnce(text('Tes stops ont été respectés.'));
    const res = await svc.chat('u1', Role.ADMIN, 'Mon bilan ?', []);
    expect(res.response).toBe('Tes stops ont été respectés.');
    expect(anthropic.create).toHaveBeenCalledTimes(2);
  });

  it('chat : non conforme deux fois → texte neutre, jamais un troisième appel', async () => {
    const { svc, anthropic } = makeService();
    anthropic.create.mockResolvedValue(text('Tu vas passer ton éval, résultat garanti.'));
    const res = await svc.chat('u1', Role.ADMIN, 'Mon bilan ?', []);
    expect(res.response).toBe(AI_TEXT_FALLBACK);
    expect(anthropic.create).toHaveBeenCalledTimes(2);
  });

  it('insights : seules les chaînes non conformes sont remplacées', async () => {
    const { svc, orchestrator } = makeService();
    const bad = {
      topPattern: "Breakout, c'est ton setup le plus rentable.",
      emotionInsight: 'Stressé, tu as multiplié les trades.',
      insights: [{ type: 'strength', title: 'Discipline', description: 'Stops respectés.', badge: 'Force' }],
    };
    orchestrator.runInsightsFlow.mockResolvedValue(bad);
    const res = (await svc.getInsights('u1', Role.ADMIN)) as typeof bad;
    expect(orchestrator.runInsightsFlow).toHaveBeenCalledTimes(2);
    expect(res.topPattern).toBe(AI_TEXT_FALLBACK);
    expect(res.emotionInsight).toBe(bad.emotionInsight);
    expect(res.insights[0]).toEqual(bad.insights[0]);
  });

  it('insights de la démo : données figées, aucun appel et aucun terme proscrit', async () => {
    const { svc, orchestrator } = makeService();
    const res = await svc.getInsights('demo', Role.USER, true);
    expect(orchestrator.runInsightsFlow).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toMatch(/edge|rentable/i);
  });

  it('récap du jour : phrase régénérée si non conforme', async () => {
    const { svc, anthropic } = makeService();
    anthropic.create.mockResolvedValueOnce(text('Demain tu seras plus rentable.')).mockResolvedValueOnce(text('Deux pertes puis une pause, comme prévu.'));
    const phrase = await svc.generateDailyOneLiner({ userId: 'u1', trades: [], pnl: 0, winRate: 0, dominantEmotion: null, date: new Date('2026-11-09T16:30:00Z') });
    expect(phrase).toBe('Deux pertes puis une pause, comme prévu.');
    expect(anthropic.create).toHaveBeenCalledTimes(2);
  });

  it('débrief hebdo : objet JSON contrôlé champ par champ', async () => {
    const { svc, debriefAgent } = makeService();
    debriefAgent.generate.mockResolvedValue({ overview: { summary: 'Optimise tes gains la semaine prochaine.' }, accounts: [] });
    const res = (await svc.generateDebrief({} as never)) as { overview: { summary: string } };
    expect(debriefAgent.generate).toHaveBeenCalledTimes(2);
    expect(res.overview.summary).toBe(AI_TEXT_FALLBACK);
  });
});
