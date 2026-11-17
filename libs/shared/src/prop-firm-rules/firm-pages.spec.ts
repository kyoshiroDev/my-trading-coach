import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROP_FIRM_CATALOG_FILES } from './catalog';
import { FIRM_PAGE_ACCOUNT_SIZE, FIRM_PAGE_EXAMPLE_PEAK, firmPlanExclusionReason, firmRulePages } from './firm-pages';

const phase = (over: Record<string, unknown> = {}) => ({
  phase: 'evaluation',
  profit_target: 3000,
  max_drawdown: { amount: 2000, type: 'trailing_eod', platform_overrides: null },
  ...over,
});
const plan = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  account_size: 50_000,
  availability: 'public',
  needs_review: false,
  phases: [phase()],
  source_urls: [`https://firm.example/${id}`],
  ...over,
});
const file = (id: string, plans: unknown[], verified_at = '2026-10-22') => ({
  firm: { id, name: id.toUpperCase(), help_center: `https://help.${id}.example` },
  verified_at,
  plans,
});

describe('firmPlanExclusionReason', () => {
  it('publie un plan public, vérifié, chiffré', () => {
    expect(firmPlanExclusionReason(plan('a'))).toBeNull();
  });
  it('exclut les plans non publics, à revérifier, sans drawdown chiffré, sans objectif, au type inconnu', () => {
    expect(firmPlanExclusionReason(plan('a', { availability: 'invite_only' }))).toMatch(/public/);
    expect(firmPlanExclusionReason(plan('a', { availability: 'discontinued' }))).toMatch(/public/);
    expect(firmPlanExclusionReason(plan('a', { needs_review: true }))).toMatch(/revérifier/);
    expect(firmPlanExclusionReason(plan('a', { phases: [phase({ max_drawdown: null })] }))).toMatch(/drawdown/);
    expect(firmPlanExclusionReason(plan('a', { phases: [phase({ max_drawdown: { amount: null, type: 'static' } })] }))).toMatch(/drawdown/);
    expect(firmPlanExclusionReason(plan('a', { phases: [phase({ max_drawdown: { amount: 0, type: 'static' } })] }))).toMatch(/drawdown/);
    expect(firmPlanExclusionReason(plan('a', { phases: [phase({ max_drawdown: { amount: -5, type: 'static' } })] }))).toMatch(/drawdown/);
    expect(firmPlanExclusionReason(plan('a', { phases: [phase({ profit_target: null })] }))).toMatch(/objectif/);
    expect(firmPlanExclusionReason(plan('a', { phases: [phase({ max_drawdown: { amount: 2000, type: 'mystere' } })] }))).toMatch(/type/);
    expect(firmPlanExclusionReason(plan('a', { phases: [] }))).toMatch(/phase/);
  });
  it("un funded sans objectif reste publiable (pas d'objectif en funded)", () => {
    expect(firmPlanExclusionReason(plan('a', { phases: [phase(), phase({ phase: 'funded', profit_target: null })] }))).toBeNull();
  });
});

describe('firmRulePages', () => {
  it('ne garde que la taille demandée et les plans publiables, avec des sources dédoublonnées', () => {
    const { pages, excluded } = firmRulePages([
      file('zeta', [plan('zeta-50k'), plan('zeta-100k', { account_size: 100_000 }), plan('zeta-review-50k', { needs_review: true }), plan('zeta-dup-50k', { source_urls: ['https://firm.example/zeta-50k'] })]),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ firmId: 'zeta', slug: 'zeta-50k', accountSize: 50_000, planIds: ['zeta-50k', 'zeta-dup-50k'], verifiedAt: '2026-10-22' });
    expect(pages[0].sources).toEqual(['https://help.zeta.example', 'https://firm.example/zeta-50k']);
    expect(excluded).toEqual([{ firmId: 'zeta', firmName: 'ZETA', planId: 'zeta-review-50k', reason: 'plan marqué à revérifier (needs_review)' }]);
  });
  it("pas de page sans date de vérification valide, ni sans plan publiable de la taille", () => {
    const { pages, excluded } = firmRulePages([
      file('nodate', [plan('nodate-50k')], ''),
      file('baddate', [plan('baddate-50k')], '22/10/2026'),
      file('none', [plan('none-100k', { account_size: 100_000 })]),
      file('allreview', [plan('allreview-50k', { needs_review: true })]),
    ]);
    expect(pages).toEqual([]);
    expect(excluded.filter((e) => !e.planId).map((e) => e.firmId)).toEqual(['nodate', 'baddate', 'none', 'allreview']);
  });
  it('signale un verrouillage dépendant de la plateforme et trie par nom de firme', () => {
    const { pages } = firmRulePages([
      file('b', [plan('b-50k', { phases: [phase({ max_drawdown: { amount: 2000, type: 'trailing_intraday', platform_overrides: { rithmic: {} } } })] })]),
      file('a', [plan('a-50k')]),
    ]);
    expect(pages.map((p) => p.firmId)).toEqual(['a', 'b']);
    expect(pages[1].platformDependent).toBe(true);
    expect(pages[0].platformDependent).toBe(false);
  });
});

describe('catalogue réel : pages publiées', () => {
  const { pages, excluded } = firmRulePages(PROP_FIRM_CATALOG_FILES);
  const files = PROP_FIRM_CATALOG_FILES as { firm: { id: string }; plans: { id: string }[] }[];
  const byId = new Map(files.flatMap((f) => f.plans.map((p) => [p.id, p] as const)));

  it('chaque page a une date, au moins un plan 50K publiable et des sources', () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(p.verifiedAt, p.firmId).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.planIds.length, p.firmId).toBeGreaterThan(0);
      expect(p.sources.length, p.firmId).toBeGreaterThan(0);
      for (const id of p.planIds) {
        const raw = byId.get(id) as Parameters<typeof firmPlanExclusionReason>[0];
        expect(raw.account_size, id).toBe(FIRM_PAGE_ACCOUNT_SIZE);
        expect(firmPlanExclusionReason(raw), id).toBeNull();
      }
    }
  });
  it("l'exemple de marge reste juste : aucun plan publié ne se fige avant le gain d'exemple, départ = taille", () => {
    type Ph = { phase: string; starting_balance?: number | null; max_drawdown: { locks_at?: number | null; platform_overrides?: Record<string, { locks_at?: number | null }> | null } };
    for (const p of pages) {
      for (const id of p.planIds) {
        const raw = byId.get(id) as unknown as { phases: Ph[] };
        const ph = raw.phases.find((x) => x.phase === 'evaluation') ?? raw.phases[0];
        expect(ph.starting_balance ?? FIRM_PAGE_ACCOUNT_SIZE, id).toBe(FIRM_PAGE_ACCOUNT_SIZE);
        const locks = [ph.max_drawdown.locks_at, ...Object.values(ph.max_drawdown.platform_overrides ?? {}).map((o) => o.locks_at)];
        for (const l of locks) if (l != null) expect(l, id).toBeGreaterThan(FIRM_PAGE_ACCOUNT_SIZE + FIRM_PAGE_EXAMPLE_PEAK);
      }
    }
  });
  it("aucun plan exclu ne se retrouve sur une page", () => {
    const published = new Set(pages.flatMap((p) => p.planIds));
    for (const e of excluded) if (e.planId) expect(published.has(e.planId), e.planId).toBe(false);
  });
});

describe('landing · pages règles des prop firms (#1071, phase 3)', () => {
  const landing = resolve(import.meta.dirname, '../../../../apps/landing-mytradingcoach/src');
  const read = (p: string) => readFileSync(resolve(landing, p), 'utf8');

  it('pages générées depuis firmPages() seulement, mention de non-affiliation affichée', () => {
    const slug = read('pages/regles-prop-firm/[slug].astro');
    const index = read('pages/regles-prop-firm/index.astro');
    expect(slug).toContain('return firmPages().map(');
    expect(slug).toContain('{FIRM_RULES_DISCLAIMER}');
    expect(index).toContain('{FIRM_RULES_DISCLAIMER}');
    expect(read('data/prop-firm-pages.ts')).toContain(
      'MyTradingCoach n’est affilié à aucune prop firm. Règles données à titre d’information, vérifie-les auprès de la firme.',
    );
  });
  it('aucun logo de prop firm ni nom de plateforme hors Tradovate', () => {
    for (const f of ['pages/regles-prop-firm/[slug].astro', 'pages/regles-prop-firm/index.astro', 'data/prop-firm-pages.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/<img/);
      for (const name of ['Binance', 'Bybit', 'MetaTrader', 'Rithmic', 'IBKR', 'MEXC']) expect(src, `${f} ${name}`).not.toContain(name);
    }
  });
});
