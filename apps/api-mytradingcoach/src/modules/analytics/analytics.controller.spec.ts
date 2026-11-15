import { describe, it, expect, vi } from 'vitest';
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
describe('AnalyticsController — par setup / émotion / heure / actif bornés à la période (#947)', () => {
  it.each(['getBySetup', 'getByEmotion', 'getByHour', 'getTopAssets'] as const)('%s transmet from / to', async (method) => {
    const service = { [method]: vi.fn().mockResolvedValue([]) };
    const accounts = { accountWhere: vi.fn().mockResolvedValue({}) };
    const ctrl = new AnalyticsController(service as never, {} as never, accounts as never);
    await (ctrl[method] as (...a: unknown[]) => Promise<unknown>)({ id: 'u1' }, undefined, undefined, '2026-10-12T00:00:00.000Z', '2026-11-11');
    const [, , , from, to] = service[method].mock.calls[0];
    expect(from).toEqual(new Date('2026-10-12T00:00:00.000Z'));
    expect(to).toBeInstanceOf(Date); // date seule → fin de journée (endBound)
    expect((to as Date).getTime()).toBeGreaterThan(new Date('2026-11-11T00:00:00.000Z').getTime());
  });
});

/**
 * E1 (#1013, décision du 14/11) : le camembert « Répartition stratégies » du FREE était calculé sur
 * les 6 derniers trades chargés, quelle que soit la période (plans.md : FREE = camembert, « ne jamais
 * verrouiller ses propres données »). Répartition sur la période, sans win rate ni P&L (Premium).
 */
describe('AnalyticsController — répartition des setups en FREE (E1)', () => {
  it('setup-shares n’est pas gardé par PremiumGuard', () => {
    expect(guardsOf('getSetupShares')).not.toContain(PremiumGuard);
  });

  it('renvoie seulement setup, titre, couleur et nombre de trades de la période (aucune profondeur)', async () => {
    const service = {
      getBySetup: vi.fn().mockResolvedValue([
        { setupId: 's1', title: 'Breakout', color: '#f00', count: 3, winRate: 66, totalPnl: 120, avgPnl: 40 },
        { setupId: 's2', title: 'Pullback', color: '#0f0', count: 0, winRate: null, totalPnl: 0, avgPnl: 0 },
      ]),
    };
    const accounts = { accountWhere: vi.fn().mockResolvedValue({ accountId: undefined }) };
    const ctrl = new AnalyticsController(service as never, {} as never, accounts as never);
    const res = await ctrl.getSetupShares({ id: 'u1' }, undefined, undefined, '2026-11-01', '2026-11-15');
    expect(service.getBySetup).toHaveBeenCalledWith('u1', undefined, false, new Date('2026-11-01'), expect.any(Date));
    expect(res).toEqual([{ setupId: 's1', title: 'Breakout', color: '#f00', count: 3 }]);
  });
});
