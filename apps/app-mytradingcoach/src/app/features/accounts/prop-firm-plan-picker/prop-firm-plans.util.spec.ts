import { describe, it, expect } from 'vitest';
import type { PropFirmCatalogFirm, PropFirmPlanSummary } from '@mtc/shared';
import { PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import { familyName, findPlan, phaseFor, programKey, programLabel, programsOf, rulesFromPlan, sizeLabel, versionDate } from './prop-firm-plans.util';

function plan(p: Partial<PropFirmPlanSummary> & { id: string }): PropFirmPlanSummary {
  return {
    planName: 'LucidFlex',
    accountSize: 50_000,
    currency: 'USD',
    availability: 'public',
    configuration: null,
    needsReview: false,
    platformDependent: [],
    phases: [
      { phase: 'evaluation', startingBalance: 50_000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: null, dailyLossLimitStatus: 'none' },
      { phase: 'funded', startingBalance: 50_000, profitTarget: null, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: 1200, dailyLossLimitStatus: 'known' },
    ],
    ...p,
  };
}

const daily = (eod: boolean, dll: boolean, size = 50_000) =>
  plan({
    id: `lucid-daily-${dll ? 'dll-' : ''}${eod ? 'eod' : 'intraday'}-${size / 1000}k`,
    planName: 'LucidDaily',
    accountSize: size,
    configuration: { dailyLossLimit: dll, evalDrawdown: eod ? 'eod' : 'intraday', payoutPath: null, addon: null },
  });

const lucid: PropFirmCatalogFirm = {
  id: 'lucid',
  name: 'Lucid Trading',
  website: 'https://lucidtrading.com',
  verifiedAt: '2026-10-02',
  plans: [
    plan({ id: 'lucid-maxx-50k', planName: 'LucidMaxx', availability: 'invite_only', phases: [plan({ id: 'x' }).phases[0]] }),
    daily(false, true),
    daily(true, true),
    daily(true, false, 100_000),
    daily(true, false),
    plan({ id: 'lucid-flex-50k' }),
  ],
};

describe('programsOf', () => {
  const programs = programsOf(lucid);

  it('un programme par nom + options, tailles triées', () => {
    expect(programs.map((p) => p.label)).toEqual([
      'LucidDaily · drawdown EOD · sans DLL',
      'LucidDaily · drawdown EOD · avec DLL',
      'LucidDaily · drawdown intraday · avec DLL',
      'LucidFlex',
      'LucidMaxx',
    ]);
    expect(programs[0].plans.map((p) => p.accountSize)).toEqual([50_000, 100_000]);
  });

  it('plans sur invitation en dernier', () => {
    expect(programs.at(-1)?.inviteOnly).toBe(true);
  });
});

describe('libellés', () => {
  it('programLabel : parcours de payout et option payante', () => {
    expect(programLabel(plan({ id: 'topstep-consistency-dll-50k', planName: 'Trading Combine',
      configuration: { dailyLossLimit: true, evalDrawdown: null, payoutPath: 'consistency', addon: null } })))
      .toBe('Trading Combine · avec DLL · payout Consistency');
    expect(programLabel(plan({ id: 'tradeify-select-daily-c50-50k', planName: 'Select',
      configuration: { dailyLossLimit: true, evalDrawdown: null, payoutPath: 'daily', addon: 'consistency 50\u00a0%' } })))
      .toBe('Select · avec DLL · payout Daily · option consistency 50\u00a0%');
  });

  it('funded qui démarre à 0 $ : le solde de départ pré-rempli suit la phase', () => {
    const xfa = plan({ id: 'topstep-standard-50k', phases: [
      { phase: 'evaluation', startingBalance: 50_000, profitTarget: 3000, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: null, dailyLossLimitStatus: 'none' },
      { phase: 'funded', startingBalance: 0, profitTarget: null, maxDrawdown: 2000, drawdownType: 'trailing_eod', dailyLossLimit: null, dailyLossLimitStatus: 'none' },
    ] });
    expect(rulesFromPlan(xfa, 'FUNDED')).toMatchObject({ accountSize: 50_000, startingBalance: 0 });
    expect(rulesFromPlan(xfa, 'EVALUATION')).toMatchObject({ startingBalance: 50_000 });
  });

  it('programLabel sans options = nom seul', () => {
    expect(programLabel(plan({ id: 'apex-eod-50k', planName: 'EOD Trail' }))).toBe('EOD Trail');
  });

  it('sizeLabel', () => {
    expect(sizeLabel(25_000)).toBe('25K');
    expect(sizeLabel(150_000)).toBe('150K');
    expect(sizeLabel(2_500)).toBe('2.5K');
  });
});

describe('findPlan', () => {
  it('retrouve firm et plan, null sinon', () => {
    expect(findPlan([lucid], 'lucid-flex-50k')?.firm.id).toBe('lucid');
    expect(findPlan([lucid], 'inconnu')).toBeNull();
    expect(findPlan([lucid], null)).toBeNull();
  });
});

describe('phaseFor / rulesFromPlan', () => {
  const flex = plan({ id: 'lucid-flex-50k' });

  it('évaluation : objectif et drawdown de la phase d’évaluation', () => {
    expect(rulesFromPlan(flex, 'EVALUATION')).toEqual({
      accountSize: 50_000,
      startingBalance: 50_000,
      currency: 'USD',
      profitTarget: 3000,
      maxDrawdown: 2000,
      drawdownType: 'TRAILING',
    });
  });

  it('funded : phase funded, sans objectif', () => {
    expect(rulesFromPlan(flex, 'FUNDED')).toMatchObject({ profitTarget: null, maxDrawdown: 2000 });
  });

  it('plan direct : la phase direct sert de funded', () => {
    const direct = plan({
      id: 'lucid-direct-50k',
      phases: [{ phase: 'direct', startingBalance: 50_000, profitTarget: null, maxDrawdown: 2500, drawdownType: 'static', dailyLossLimit: null, dailyLossLimitStatus: 'none' }],
    });
    expect(phaseFor(direct, 'FUNDED')?.phase).toBe('direct');
    expect(rulesFromPlan(direct, 'FUNDED')).toMatchObject({ maxDrawdown: 2500, drawdownType: 'STATIC' });
    expect(phaseFor(direct, 'EVALUATION')).toBeNull();
  });

  it('phase absente : taille reprise, objectif et drawdown à saisir', () => {
    const maxx = lucid.plans[0];
    expect(rulesFromPlan(maxx, 'FUNDED')).toEqual({
      accountSize: 50_000,
      startingBalance: 50_000,
      currency: 'USD',
      profitTarget: null,
      maxDrawdown: null,
      drawdownType: null,
    });
  });
});

describe('programsOf, plan plus vendu', () => {
  const firm: PropFirmCatalogFirm = {
    ...lucid,
    plans: [plan({ id: 'lucid-flex-50k' }), plan({ id: 'lucid-old-50k', planName: 'Ancien', availability: 'discontinued' })],
  };

  it('masque le plan à l\'achat', () => {
    expect(programsOf(firm).flatMap((p) => p.plans.map((x) => x.id))).toEqual(['lucid-flex-50k']);
  });

  it('le garde pour le compte qui y est déjà lié', () => {
    expect(programsOf(firm, 'lucid-old-50k').flatMap((p) => p.plans.map((x) => x.id))).toContain('lucid-old-50k');
  });

  it('findPlan le retrouve toujours', () => {
    expect(findPlan([firm], 'lucid-old-50k')?.plan.id).toBe('lucid-old-50k');
  });
});

describe('programsOf, versions d’une même famille (#1244)', () => {
  // FFF : l'ancienne version est publique, le plan en vente et la version intermédiaire sont sur invitation.
  const fff: PropFirmCatalogFirm = {
    id: 'fff', name: 'Funded Futures Family', website: 'https://exemple.invalid', verifiedAt: '2026-11-23',
    plans: [
      plan({ id: 'acc-old-50k', planName: 'Accelerate S2F (achat avant le 22/10/2026)' }),
      plan({ id: 'acc-oct22-50k', planName: 'Accelerate S2F (achat du 22/10/2026 au 29/10/2026)', availability: 'invite_only' }),
      plan({ id: 'acc-50k', planName: 'Accelerate S2F', availability: 'invite_only' }),
      plan({ id: 'payday-50k', planName: 'S2F Payday' }),
      plan({ id: 'sniper-50k', planName: 'Sniper', availability: 'invite_only' }),
    ],
  };

  it('plan en vente d’abord, puis les versions de la plus récente à la plus ancienne, quelle que soit la visibilité', () => {
    expect(programsOf(fff).map((p) => p.plans[0].id)).toEqual(['acc-50k', 'acc-oct22-50k', 'acc-old-50k', 'payday-50k', 'sniper-50k']);
  });

  it('une famille entièrement sur invitation reste en dernier ; une famille dont une version est publique non', () => {
    const order = programsOf(fff).map((p) => p.plans[0].planName);
    expect(order.at(-1)).toBe('Sniper');
    expect(order.indexOf('Accelerate S2F')).toBeLessThan(order.indexOf('S2F Payday'));
  });

  it('familyName et versionDate (JJ/MM/AAAA ou AAAA-MM-JJ, la plus récente)', () => {
    expect(familyName('Accelerate S2F (achat avant le 22/10/2026)')).toBe('Accelerate S2F');
    expect(familyName('Accelerate S2F')).toBe('Accelerate S2F');
    expect(versionDate('Accelerate S2F (achat du 22/10/2026 au 29/10/2026)')).toBe('2026-10-29');
    expect(versionDate('Select 300K V1 (achat avant le 2026-08-27)')).toBe('2026-08-27');
    expect(versionDate('Straight to Funded (règles relevées le 02/11/2026)')).toBe('2026-11-02');
    expect(versionDate('Accelerate S2F')).toBeNull();
    expect(versionDate('Select 300K (V2)')).toBeNull();
  });
});

describe('programsOf, options de même rang (#1234)', () => {
  const opt = (id: string, payoutPath: 'consistency' | 'standard' | null, addon: string | null) =>
    plan({ id, planName: 'LucidDaily', configuration: { dailyLossLimit: false, evalDrawdown: 'eod', payoutPath, addon } });

  it('égalité de rang départagée par libellé, quel que soit l’ordre d’arrivée', () => {
    const labels = (ids: string[]) => {
      const all = { a: opt('a', null, 'c50'), b: opt('b', null, 'funded EOD'), c: opt('c', null, 'funded EOD + c30') };
      const firm: PropFirmCatalogFirm = { ...lucid, plans: ids.map((i) => all[i as keyof typeof all]) };
      return programsOf(firm).map((p) => p.label);
    };
    const expected = [...labels(['a', 'b', 'c'])].sort((x, y) => x.localeCompare(y));
    expect(labels(['a', 'b', 'c'])).toEqual(expected);
    expect(labels(['c', 'b', 'a'])).toEqual(expected);
  });
});

describe('catalogue réel : un programme par taille (#1229)', () => {
  // Deux plans de même taille et même programKey dans une firm : programsOf et l'assistant de liaison
  // n'en proposeraient qu'un, sans message. Le catalogue ne doit jamais en contenir.
  type RawPlan = {
    id: string; plan_name: string; account_size: number;
    configuration: {
      daily_loss_limit: boolean | null; eval_drawdown: 'eod' | 'intraday' | null;
      payout_path?: 'standard' | 'consistency' | 'flex' | 'daily' | null; addon?: string | null;
    } | null;
  };
  const files = PROP_FIRM_CATALOG_FILES as { firm: { id: string }; plans: RawPlan[] }[];

  it('aucune firm n’a deux plans de même taille et même programKey', () => {
    const doublons: string[] = [];
    for (const f of files) {
      const seen = new Map<string, string>();
      for (const p of f.plans) {
        const c = p.configuration;
        const key = `${p.account_size}|${programKey({
          planName: p.plan_name,
          // Même passage snake_case → contrat que `planConfiguration` (API) : une option ajoutée au contrat va aux deux.
          configuration: c && { dailyLossLimit: c.daily_loss_limit, evalDrawdown: c.eval_drawdown, payoutPath: c.payout_path ?? null, addon: c.addon ?? null },
        })}`;
        const other = seen.get(key);
        if (other) doublons.push(`${f.firm.id} : ${other} et ${p.id}`);
        seen.set(key, p.id);
      }
    }
    expect(doublons).toEqual([]);
  });
});
