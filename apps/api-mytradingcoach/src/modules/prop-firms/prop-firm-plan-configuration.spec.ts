import { describe, it, expect } from 'vitest';
import { planConfiguration, planConfigurationOrNull } from './prop-firm-plan-configuration';

describe('planConfiguration (#1236)', () => {
  it('Json du catalogue → format du contrat front, champs absents à null', () => {
    expect(planConfiguration({ daily_loss_limit: false, eval_drawdown: 'eod', addon: 'consistency 50 %' })).toEqual({
      dailyLossLimit: false, evalDrawdown: 'eod', payoutPath: null, addon: 'consistency 50 %',
    });
  });

  it('plan sans option : null', () => {
    expect(planConfiguration(null)).toBeNull();
    expect(planConfiguration(undefined)).toBeNull();
  });

  it('variante tolérante (règle d’un compte) : Json illisible → null, sans lever', () => {
    expect(() => planConfiguration({ inconnu: true })).toThrow();
    expect(planConfigurationOrNull({ inconnu: true })).toBeNull();
    expect(planConfigurationOrNull({ daily_loss_limit: true, eval_drawdown: null })).toMatchObject({ dailyLossLimit: true });
  });
});
