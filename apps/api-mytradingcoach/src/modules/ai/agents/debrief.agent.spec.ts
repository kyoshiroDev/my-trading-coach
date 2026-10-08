import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { DebriefAgent, debriefMaxTokens } from './debrief.agent';

// Clé factice pour que le constructeur Anthropic ne réclame rien (aucun réseau au build).
process.env['ANTHROPIC_API_KEY'] ??= 'sk-ant-test';

function makeAgent() {
  // Client central mocké : jamais d'appel réel (coût/flakiness). Le log est interne
  // au client → on ne vérifie ici que l'appel et la `meta` transmise.
  const create = vi.fn();
  const agent = new DebriefAgent({ create } as never);
  return { agent, create };
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

  it('AI_DEBRIEF_DEV=true → appelle le modèle (mocké), parse, et passe la bonne meta', async () => {
    process.env['AI_DEBRIEF_DEV'] = 'true';
    const { agent, create } = makeAgent();
    (create as Mock).mockResolvedValue({
      content: [{ type: 'text', text: '{"overview":{"summary":"vrai"},"accounts":[]}' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const res = await agent.generate(DATA as never, 'user-1');
    expect(create).toHaveBeenCalledOnce();
    expect(res).toEqual({ overview: { summary: 'vrai' }, accounts: [] });
    // Le client central reçoit la feature + userId pour le log automatique.
    expect(create).toHaveBeenCalledWith(expect.any(Object), { feature: 'debrief', userId: 'user-1' });
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

describe('debriefMaxTokens — budget de sortie (+25 % le 2026-10-08)', () => {
  it('2 comptes → 4 750 (au lieu de 3 800), 1 compte → 3 625', () => {
    expect(debriefMaxTokens(2)).toBe(4_750);
    expect(debriefMaxTokens(1)).toBe(3_625);
  });

  it('chaque palier vaut 125 % de l’ancien, plafond 10 240 (au lieu de 8 192)', () => {
    for (let n = 1; n <= 10; n++) {
      expect(debriefMaxTokens(n)).toBe(Math.round(Math.min(8192, 2000 + n * 900) * 1.25));
    }
    expect(debriefMaxTokens(7)).toBe(10_240);
  });
});
