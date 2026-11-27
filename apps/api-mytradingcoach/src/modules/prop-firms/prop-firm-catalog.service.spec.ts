import { describe, it, expect } from 'vitest';
import { planConfiguration } from './prop-firm-catalog.service';

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
});
