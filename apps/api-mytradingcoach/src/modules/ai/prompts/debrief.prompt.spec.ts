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
