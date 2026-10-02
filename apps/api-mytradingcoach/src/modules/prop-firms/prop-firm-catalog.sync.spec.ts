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
  it('accepte le catalogue livré (Lucid + Apex) : le Zod suit schema.json', () => {
    const catalog = parseCatalog(PROP_FIRM_CATALOG_FILES);
    expect(catalog.map((f) => f.firm.id)).toEqual(['lucid', 'apex']);
    expect(catalog.reduce((n, f) => n + f.plans.length, 0)).toBe(48);
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
    expect(firms.map((f) => f.id)).toEqual(['lucid', 'apex']);
    expect(plans).toHaveLength(48);
    expect(firms[1].verifiedAt).toEqual(new Date('2026-10-02T00:00:00Z'));
  });

  it('mappe les colonnes de requête et garde les règles au format du catalogue', () => {
    const plan = plans.find((p) => p.id === 'apex-eod-50k')!;
    expect(plan).toMatchObject({ firmId: 'apex', accountSize: 50_000, currency: 'USD', availability: 'public', active: true });
    expect(plan.phases).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'evaluation', profit_target: 3000 })]));
  });

  it('LucidMaxx reste invite_only et needs_review', () => {
    const maxx = plans.find((p) => p.id === 'lucid-maxx-50k')!;
    expect(maxx.availability).toBe('invite_only');
    expect(maxx.needsReview).toBe(true);
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

  it('base vide : crée les 2 firms et les 48 plans', () => {
    const plan = planCatalogSync(catalog, { firms: [], plans: [] });
    expect(plan.firmsToCreate).toHaveLength(2);
    expect(plan.plansToCreate).toHaveLength(48);
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
    state.plans.push({ id: 'apex-legacy-50k', contentHash: 'x', active: true });
    const plan = planCatalogSync(catalog, state);
    expect(plan.planIdsToDeactivate).toEqual(['apex-legacy-50k']);
  });

  it('plan déjà désactivé et toujours absent : rien à faire', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.push({ id: 'apex-legacy-50k', contentHash: 'x', active: false });
    expect(isNoop(planCatalogSync(catalog, state))).toBe(true);
  });

  it('plan revenu dans le catalogue après un retrait : réactivé même à contenu égal', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.find((p) => p.id === 'lucid-flex-50k')!.active = false;
    const plan = planCatalogSync(catalog, state);
    expect(plan.plansToUpdate.map((p) => [p.id, p.active])).toEqual([['lucid-flex-50k', true]]);
  });
});
