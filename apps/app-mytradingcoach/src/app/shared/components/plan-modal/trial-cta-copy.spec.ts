import { describe, it, expect } from 'vitest';
import ANALYTICS from '../../../features/analytics/analytics.component.html?raw';
import SCORING from '../../../features/scoring/scoring.component.html?raw';
import AI_INSIGHTS from '../../../features/ai-insights/ai-insights.component.html?raw';
import DEBRIEF from '../../../features/weekly-debrief/debrief.component.html?raw';
import DASHBOARD from '../../../features/dashboard/dashboard.component.html?raw';
import PROFILE from '../../../features/profile/profile.component.html?raw';

/**
 * « 1 mois offert » n'est vrai que si l'essai Stripe reste disponible (`trialUsed` faux) : après un
 * mois Premium offert par l'admin ou un premier abonnement, le checkout prélève tout de suite.
 * Chaque mention doit donc dépendre de `userStore.trialAvailable()` (même règle que la modale des
 * offres et le cadenas Premium), sur la même ligne ou sous un `@if` / `@else if` qui la teste.
 */
const TEMPLATES = { ANALYTICS, SCORING, AI_INSIGHTS, DEBRIEF, DASHBOARD, PROFILE };

function unconditionalMentions(html: string): string[] {
  const lines = html.split('\n');
  return lines.filter((line, i) => {
    if (!/1 mois offert|Essayer Premium/.test(line)) return false;
    if (line.includes('trialAvailable()')) return false;
    const opener = lines.slice(0, i).reverse().find((l) => /@(if|else if|else)\b/.test(l));
    return !opener?.includes('trialAvailable()');
  }).map((l) => l.trim());
}

describe('libellés d’essai des paywalls Premium (trialUsed)', () => {
  for (const [name, html] of Object.entries(TEMPLATES)) {
    it(`${name} : aucune promesse « 1 mois offert » sans condition sur l’essai`, () => {
      expect(unconditionalMentions(html)).toEqual([]);
    });
  }

  it('le garde-fou détecte bien un libellé en dur', () => {
    expect(unconditionalMentions('<button>\n  Essayer Premium · 1 mois offert →\n</button>')).toHaveLength(1);
  });
});
