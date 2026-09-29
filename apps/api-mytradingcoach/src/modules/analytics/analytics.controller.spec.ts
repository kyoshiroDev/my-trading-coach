import { describe, it, expect } from 'vitest';
import { AnalyticsController } from './analytics.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PremiumGuard } from '../../common/guards/premium.guard';

/**
 * verrouille le contrat de gating des analytics.
 *
 * L'activité (calendrier) = les données propres de l'utilisateur → FREE. Le guard
 * posé sur `activity/:year/:month` était de surcroît fantôme : `activity/range`
 * sert la même donnée (même `computeDailyActivity`) sans guard, un compte FREE
 * l'obtenait donc en changeant d'URL.
 *
 * La profondeur d'analyse (`by-setup`, `by-hour`) reste Premium : ce test casse
 * si l'un des deux côtés bouge par erreur.
 */
function guardsOf(method: string): unknown[] {
  const handler = (AnalyticsController.prototype as unknown as Record<string, object>)[method];
  return (Reflect.getMetadata('__guards__', handler) ?? []) as unknown[];
}

describe('AnalyticsController — gating par plan', () => {
  it('le controller entier exige une connexion (JwtAuthGuard)', () => {
    const guards = (Reflect.getMetadata('__guards__', AnalyticsController) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(PremiumGuard);
  });

  describe('activité = FREE (donnée propre de l\'utilisateur)', () => {
    it.each([
      ['getMonthActivity', 'activity/:year/:month'],
      ['getActivityRange', 'activity/range'],
      ['getCurrentMonthActivity', 'activity/current-month'],
    ])('%s (%s) n\'est pas gardé par PremiumGuard', (method) => {
      expect(
        guardsOf(method),
        'Tout accès à l\'activité doit rester gratuit et cohérent entre les 3 routes',
      ).not.toContain(PremiumGuard);
    });
  });

  describe('profondeur d\'analyse = PREMIUM', () => {
    it.each([
      ['getBySetup', 'by-setup'],
      ['getByHour', 'by-hour'],
    ])('%s (%s) reste gardé par PremiumGuard', (method) => {
      expect(guardsOf(method)).toContain(PremiumGuard);
    });
  });

  it('les vues de base restent FREE (summary, by-emotion, equity)', () => {
    for (const m of ['getSummary', 'getByEmotion', 'getEquityCurve', 'getTopAssets']) {
      expect(guardsOf(m), `${m} doit rester accessible en FREE`).not.toContain(PremiumGuard);
    }
  });
});