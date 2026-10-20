import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FunnelEventDto } from './funnel-event.dto';

const check = (body: object) => validate(plainToInstance(FunnelEventDto, body));

describe('FunnelEventDto', () => {
  it('accepte chaque étape du parcours', async () => {
    for (const step of ['cta_click', 'register_view', 'register_submit', 'register_success', 'register_error', 'checkout_redirect']) {
      expect(await check({ step })).toHaveLength(0);
    }
  });

  it("accepte les étapes d'engagement et borne la page", async () => {
    for (const step of ['scroll_depth', 'time_on_page', 'rules_use']) {
      expect(await check({ step, path: '/prop-firm' })).toHaveLength(0);
    }
    expect(await check({ step: 'scroll_depth', path: '/'.repeat(65) })).not.toHaveLength(0);
    expect(await check({ step: 'scroll_depth', path: 42 })).not.toHaveLength(0);
  });

  it("refuse landing_view (compté par /public/visit) et une étape inconnue", async () => {
    expect(await check({ step: 'landing_view' })).not.toHaveLength(0);
    expect(await check({ step: 'purchase' })).not.toHaveLength(0);
    expect(await check({})).not.toHaveLength(0);
  });

  it('normalise source, medium et campagne comme les visites', async () => {
    const dto = plainToInstance(FunnelEventDto, { step: 'cta_click', source: ' Instagram ', medium: 'PAID', campaign: '  ' });
    expect(await validate(dto)).toHaveLength(0);
    expect([dto.source, dto.medium, dto.campaign]).toEqual(['instagram', 'paid', undefined]);
  });

  it('exige un vrai booléen pour inApp et borne detail', async () => {
    expect(await check({ step: 'cta_click', inApp: 'yes' })).not.toHaveLength(0);
    expect(await check({ step: 'cta_click', inApp: true })).toHaveLength(0);
    expect(await check({ step: 'cta_click', detail: 'x'.repeat(33) })).not.toHaveLength(0);
    expect(await check({ step: 'cta_click', source: 'x'.repeat(101) })).not.toHaveLength(0);
  });
});
