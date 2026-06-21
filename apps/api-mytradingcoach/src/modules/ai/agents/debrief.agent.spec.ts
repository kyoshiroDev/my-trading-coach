import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DebriefAgent } from './debrief.agent';

// Clé factice pour que le constructeur Anthropic ne réclame rien (aucun réseau au build).
process.env['ANTHROPIC_API_KEY'] ??= 'sk-ant-test';

function makeAgent() {
  const aiLogger = { log: vi.fn() };
  const agent = new DebriefAgent(aiLogger as never);
  // Remplace l'instance Anthropic par un mock (jamais d'appel réel — coût/flakiness).
  const create = vi.fn();
   
  (agent as any).anthropic = { messages: { create } };
  return { agent, create, aiLogger };
}

const DATA = { trades: [], stats: {}, previousObjectives: [], weekNumber: 1, year: 2026, accounts: [] };

describe('DebriefAgent.generate — garde coût IA (W1)', () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
    delete process.env['AI_DEBRIEF_DEV'];
  });
  afterEach(() => { process.env = { ...ORIG }; });

  it('hors prod sans opt-in → stub structuré, AUCUN appel modèle', async () => {
    const { agent, create } = makeAgent();
    const res = await agent.generate(DATA as never);
    expect(res).toEqual({ overview: { summary: '(débrief IA disponible en production)' }, accounts: [] });
    expect(create).not.toHaveBeenCalled();
  });

  it('AI_DEBRIEF_DEV=true → appelle le modèle (mocké) et parse la réponse', async () => {
    process.env['AI_DEBRIEF_DEV'] = 'true';
    const { agent, create, aiLogger } = makeAgent();
    (create as Mock).mockResolvedValue({
      content: [{ type: 'text', text: '{"overview":{"summary":"vrai"},"accounts":[]}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const res = await agent.generate(DATA as never, 'user-1');
    expect(create).toHaveBeenCalledOnce();
    expect(res).toEqual({ overview: { summary: 'vrai' }, accounts: [] });
    expect(aiLogger.log).toHaveBeenCalledWith('user-1', 'debrief', { input_tokens: 10, output_tokens: 5 });
  });

  it('en production → appelle le modèle (pas de stub)', async () => {
    process.env['NODE_ENV'] = 'production';
    const { agent, create } = makeAgent();
    (create as Mock).mockResolvedValue({
      content: [{ type: 'text', text: '{"overview":{"summary":"prod"},"accounts":[]}' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await agent.generate(DATA as never);
    expect(create).toHaveBeenCalledOnce();
  });
});
