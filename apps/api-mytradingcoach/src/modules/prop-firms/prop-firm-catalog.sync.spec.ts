import { describe, it, expect } from 'vitest';
import { PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import { contentHash, isNoop, parseCatalog, planCatalogSync, toRows } from './prop-firm-catalog.sync';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** État en base équivalent à un catalogue déjà synchronisé. */
function syncedState(files: readonly unknown[]) {
  const { firms, plans } = toRows(parseCatalog(files));
  return {
    firms: firms.map((f) => ({ id: f.id, contentHash: f.contentHash })),
    plans: plans.map((p) => ({ id: p.id, contentHash: p.contentHash, active: true })),
  };
}

describe('parseCatalog', () => {
  it('accepte le catalogue livré (16 firms) : le Zod suit schema.json', () => {
    const catalog = parseCatalog(PROP_FIRM_CATALOG_FILES);
    expect(catalog.map((f) => f.firm.id)).toEqual([
      'lucid', 'apex', 'topstep', 'tradeify', 'myfundedfutures', 'tradeday', 'takeprofittrader', 'phidias',
      'earn2trade', 'toponefutures', 'blusky', 'fundedfuturesfamily', 'oneuptrader', 'uprofit', 'bulenox', 'elitetraderfunding',
    ]);
    expect(catalog.reduce((n, f) => n + f.plans.length, 0)).toBe(255);
  });

  it('refuse un champ inconnu (objets stricts, comme additionalProperties: false)', () => {
    const files = clone(PROP_FIRM_CATALOG_FILES) as { plans: Record<string, unknown>[] }[];
    files[1].plans[0]['drawdown'] = 2000;
    expect(() => parseCatalog(files)).toThrow(/fichier n°2 invalide/);
  });

  it('refuse un montant au format texte', () => {
    const files = clone(PROP_FIRM_CATALOG_FILES) as { plans: { account_size: unknown }[] }[];
    files[0].plans[0].account_size = '$50,000';
    expect(() => parseCatalog(files)).toThrow(/plans\.0\.account_size/);
  });

  it('refuse un id de plan présent dans deux fichiers', () => {
    const files = clone(PROP_FIRM_CATALOG_FILES) as { plans: { id: string }[] }[];
    files[1].plans[0].id = files[0].plans[0].id;
    expect(() => parseCatalog(files)).toThrow(`plan en double : ${files[0].plans[0].id}`);
  });

  it('refuse une firm présente deux fois', () => {
    const files = clone(PROP_FIRM_CATALOG_FILES) as { firm: { id: string }; plans: { id: string }[] }[];
    const twin = clone(files[1]);
    twin.plans = twin.plans.map((p) => ({ ...p, id: `${p.id}-bis` }));
    expect(() => parseCatalog([...files, twin])).toThrow('firm en double : apex');
  });
});

describe('toRows', () => {
  const { firms, plans } = toRows(parseCatalog(PROP_FIRM_CATALOG_FILES));

  it('une ligne par firm et par plan, avec la date du relevé', () => {
    expect(firms.map((f) => f.id)).toEqual([
      'lucid', 'apex', 'topstep', 'tradeify', 'myfundedfutures', 'tradeday', 'takeprofittrader', 'phidias',
      'earn2trade', 'toponefutures', 'blusky', 'fundedfuturesfamily', 'oneuptrader', 'uprofit', 'bulenox', 'elitetraderfunding',
    ]);
    expect(plans).toHaveLength(255);
    expect(firms[1].verifiedAt).toEqual(new Date('2026-10-07T00:00:00Z'));
  });

  it('mappe les colonnes de requête et garde les règles au format du catalogue', () => {
    const plan = plans.find((p) => p.id === 'apex-eod-50k')!;
    expect(plan).toMatchObject({ firmId: 'apex', accountSize: 50_000, currency: 'USD', availability: 'public', active: true });
    expect(plan.phases).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'evaluation', profit_target: 3000 })]));
  });

  it('Apex Legacy : abonnement mensuel, plafond libre à partir du 6e payout', () => {
    const legacy = plans.find((p) => p.id === 'apex-legacy-50k')!;
    expect(legacy).toMatchObject({ planName: 'Legacy Full', accountSize: 50_000, needsReview: false });
    expect(legacy.price).toMatchObject({ amount: 197, billing: 'monthly', activation_fee: 99 });
    const pa = (legacy.phases as { phase: string; payout: { max_amount_schedule: (number | null)[] } | null }[]).find((p) => p.phase === 'funded')!;
    expect(pa.payout?.max_amount_schedule).toEqual([2000, 2000, 2000, 2000, 2000, null]);
    // Scaling Legacy en PA (support Apex, 2026-10-05) : moitié arrondie à l'inférieur jusqu'au safety net.
    const pa150 = (plans.find((p) => p.id === 'apex-legacy-150k')!.phases as { phase: string; max_contracts: { tiers: unknown } }[]).find((p) => p.phase === 'funded')!;
    expect(pa150.max_contracts.tiers).toEqual([
      { min_profit: 0, max_profit: 5100, minis: 8, micros: 80 },
      { min_profit: 5101, max_profit: null, minis: 17, micros: 170 },
    ]);
  });

  it('relevé du 2026-10-03 : valeurs clés des 4 nouvelles firms', () => {
    type Ph = { phase: string; starting_balance?: number; max_drawdown: { amount: number; type: string; locks_at: number | null; locked_floor?: number | null };
      consistency: { max_single_day_pct: number; max_single_day_pct_schedule?: number[] } | null;
      payout: { split_pct: number | null; split_by_profit?: { profit_over: number; split_pct: number } } | null };
    const phases = (id: string) => plans.find((p) => p.id === id)!.phases as Ph[];
    const funded = (id: string) => phases(id).find((p) => p.phase !== 'evaluation')!;

    // Topstep XFA : solde de départ 0, MLL -2 000 verrouillé à 0 quand le solde atteint 2 000.
    expect(funded('topstep-standard-50k')).toMatchObject({ starting_balance: 0, max_drawdown: { amount: 2000, locks_at: 2000, locked_floor: 0 } });
    expect(phases('topstep-standard-50k')[0].max_drawdown).toMatchObject({ amount: 2000, type: 'trailing_eod', locks_at: 52000, locked_floor: 50000 });
    // TradeDay : seuil figé au solde de départ exact (pas + 100 $).
    expect(phases('tradeday-qp-intraday-100k')[0].max_drawdown).toMatchObject({ amount: 3000, type: 'trailing_intraday', locks_at: 103000, locked_floor: 100000 });
    expect(funded('tradeday-qp-eod-50k').max_drawdown.type).toBe('trailing_intraday'); // Quick Pay funded toujours intraday
    expect(funded('tradeday-fp-eod-50k').max_drawdown.type).toBe('trailing_eod'); // Fast Pass funded toujours EOD
    expect(funded('tradeday-qp-eod-50k').payout).toMatchObject({ split_pct: 0.5, split_by_profit: { profit_over: 4000, split_pct: 0.8 } });
    // Tradeify : Growth 1 000 / 2 000 / 3 500 / 5 000 ; Lightning consistency par palier ; lock funded seulement.
    expect([25, 50, 100, 150].map((k) => phases(`tradeify-growth-${k}k`)[0].max_drawdown.amount)).toEqual([1000, 2000, 3500, 5000]);
    expect(phases('tradeify-growth-50k')[0].max_drawdown.locks_at).toBeNull();
    expect(funded('tradeify-growth-50k').max_drawdown).toMatchObject({ locks_at: 52100, locked_floor: 50100 });
    expect(funded('tradeify-lightning-50k').consistency).toMatchObject({ max_single_day_pct: 0.2, max_single_day_pct_schedule: [0.2, 0.25, 0.3] });
    // MyFundedFutures : Rapid funded intraday depuis 0 $, verrouillé à 100 $ ; Pro verrouillé après le 1er payout.
    expect(funded('myfundedfutures-rapid-50k')).toMatchObject({ starting_balance: 0, max_drawdown: { type: 'trailing_intraday', locks_at: 2100, locked_floor: 100 } });
    expect(funded('myfundedfutures-pro-50k').max_drawdown).toMatchObject({ locks_at: null, locked_floor: 50100 });
  });

  it('LucidMaxx reste invite_only, complet depuis la réponse du support (2026-10-05)', () => {
    const maxx = plans.find((p) => p.id === 'lucid-maxx-50k')!;
    expect(maxx.availability).toBe('invite_only');
    expect(maxx.needsReview).toBe(false);
    const ev = (maxx.phases as { max_contracts: { minis: number }; max_drawdown: { locks_at: number; locked_floor: number } }[])[0];
    expect(ev.max_contracts.minis).toBe(4);
    expect(ev.max_drawdown).toMatchObject({ locks_at: 52_100, locked_floor: 50_100 });
  });

  it('empreinte stable entre deux lectures, sensible au moindre changement de règle', () => {
    const again = toRows(parseCatalog(clone(PROP_FIRM_CATALOG_FILES))).plans;
    expect(again.map((p) => p.contentHash)).toEqual(plans.map((p) => p.contentHash));

    const files = clone(PROP_FIRM_CATALOG_FILES) as { plans: { phases: { max_drawdown: { amount: number } }[] }[] }[];
    files[1].plans[0].phases[0].max_drawdown.amount += 1;
    expect(toRows(parseCatalog(files)).plans[40].contentHash).not.toBe(plans[40].contentHash);
  });

  it('contentHash dépend du contenu, pas de l’instance', () => {
    expect(contentHash({ a: 1 })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe('planCatalogSync', () => {
  const catalog = parseCatalog(PROP_FIRM_CATALOG_FILES);

  it('base vide : crée les 16 firms et les 255 plans', () => {
    const plan = planCatalogSync(catalog, { firms: [], plans: [] });
    expect(plan.firmsToCreate).toHaveLength(16);
    expect(plan.plansToCreate).toHaveLength(255);
    expect(plan.firmsToUpdate).toEqual([]);
    expect(plan.plansToUpdate).toEqual([]);
    expect(plan.planIdsToDeactivate).toEqual([]);
  });

  it('base déjà alignée : aucune écriture', () => {
    expect(isNoop(planCatalogSync(catalog, syncedState(PROP_FIRM_CATALOG_FILES)))).toBe(true);
  });

  it('règle modifiée : met à jour ce plan seulement', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.find((p) => p.id === 'apex-eod-50k')!.contentHash = 'ancienne';
    const plan = planCatalogSync(catalog, state);
    expect(plan.plansToUpdate.map((p) => p.id)).toEqual(['apex-eod-50k']);
    expect(plan.plansToCreate).toEqual([]);
  });

  it('relevé d’une firm modifié : met à jour la firm', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.firms[0].contentHash = 'ancienne';
    expect(planCatalogSync(catalog, state).firmsToUpdate.map((f) => f.id)).toEqual(['lucid']);
  });

  it('plan retiré du catalogue : désactivé, jamais supprimé', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.push({ id: 'apex-retire-50k', contentHash: 'x', active: true });
    const plan = planCatalogSync(catalog, state);
    expect(plan.planIdsToDeactivate).toEqual(['apex-retire-50k']);
  });

  it('plan déjà désactivé et toujours absent : rien à faire', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.push({ id: 'apex-retire-50k', contentHash: 'x', active: false });
    expect(isNoop(planCatalogSync(catalog, state))).toBe(true);
  });

  it('plan revenu dans le catalogue après un retrait : réactivé même à contenu égal', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.find((p) => p.id === 'lucid-flex-50k')!.active = false;
    const plan = planCatalogSync(catalog, state);
    expect(plan.plansToUpdate.map((p) => [p.id, p.active])).toEqual([['lucid-flex-50k', true]]);
  });
});
