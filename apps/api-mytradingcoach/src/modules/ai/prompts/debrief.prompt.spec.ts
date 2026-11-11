import { describe, it, expect } from 'vitest';
import { buildDebriefPrompt } from './debrief.prompt';

const base = { trades: [], stats: {}, previousObjectives: [], weekNumber: 23, year: 2026 };

describe('buildDebriefPrompt — suivi prop firm en direct (#374)', () => {
  it('bloc présent : injecté tel quel, avec la consigne de ne rien recalculer', () => {
    const p = buildDebriefPrompt({ ...base, propContext: '- « Apex 50k » : marge drawdown la plus basse $210 à 10:42' });
    expect(p).toContain('SUIVI PROP FIRM EN DIRECT');
    expect(p).toContain('ne recalcule rien');
    expect(p).toContain('marge drawdown la plus basse $210 à 10:42');
    expect(p).toContain('s\'appuie D\'ABORD dessus');
  });

  it('sans bloc : aucune section prop firm en direct', () => {
    expect(buildDebriefPrompt(base)).not.toContain('SUIVI PROP FIRM EN DIRECT (');
  });
});

describe('buildDebriefPrompt · vocabulaire du drawdown (#936)', () => {
  it('taille de la règle = « règle de drawdown », marge = « avant le plancher », jamais « drawdown max »', () => {
    const p = buildDebriefPrompt({
      ...base,
      accounts: [{
        accountId: 'compte-1', name: 'Apex 50K', type: 'EVALUATION', currency: 'USD',
        startingBalance: 50000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'TRAILING', tradesCount: 3,
      }],
    } as Parameters<typeof buildDebriefPrompt>[0]);
    expect(p).toMatch(/règle de drawdown \$2,000/);
    expect(p).toContain('MARGE estimée avant le plancher');
    expect(p).not.toMatch(/drawdown max/i);
    expect(p).not.toMatch(/avant drawdown/i);
  });
});
