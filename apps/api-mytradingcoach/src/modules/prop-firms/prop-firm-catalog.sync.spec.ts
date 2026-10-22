import { describe, it, expect } from 'vitest';
import { PROP_FIRM_CATALOG_FILES } from '@mtc/shared';
import { contentHash, isNoop, parseCatalog, planCatalogSync, toRows } from './prop-firm-catalog.sync';

/*
 * Aucun prix, date de relevé ni règle d'un plan précis n'est figé ici : la veille modifie le
 * catalogue chaque semaine. On vérifie la synchro (logique pure) et la cohérence du catalogue.
 */

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type RawContracts = { minis: number | null; micros: number | null; tiers?: { minis: number | null; micros: number | null }[] | null } | null;
type RawFile = {
  firm: { id: string };
  verified_at: string;
  plans: { id: string; account_size: number; source_urls: string[]; phases: { phase: string; max_contracts: RawContracts }[] }[];
};
const RAW = PROP_FIRM_CATALOG_FILES as unknown as RawFile[];
const FIRM_IDS = RAW.map((f) => f.firm.id);
const PLAN_COUNT = RAW.reduce((n, f) => n + f.plans.length, 0);

/**
 * Plans dont les micros ne valent pas 10 × les minis, avec la raison. Le détecteur A1 lit
 * `micros` tel quel quand la position n'est faite que de micros : toute nouvelle notation doit
 * être relue (micro compté comme un contrat, ou coquille de la firm ?) avant d'entrer ici.
 */
const CONTRACT_NOTATION_EXCEPTIONS: { match: RegExp; phase: string | null; reason: string }[] = [
  { match: /^oneuptrader-/, phase: null, reason: 'un micro compte comme un contrat (support OneUp, 2026-10-06)' },
  { match: /^elitetraderfunding-dtf-/, phase: 'direct', reason: 'Direct to Funded : 1 mini = 1 micro' },
  { match: /^myfundedfutures-pro-/, phase: 'funded', reason: '« 3 mini / 3 micro » publié en Sim Funded (page du plan, article 17573707)' },
  { match: /^tradeday-(fp|qp)-.*-(100k|150k)$/, phase: null, reason: 'micros plafonnés à 50 (« 10 Contracts (50 Micros) »)' },
];

/** État en base équivalent à un catalogue déjà synchronisé. */
function syncedState(files: readonly unknown[]) {
  const { firms, plans } = toRows(parseCatalog(files));
  return {
    firms: firms.map((f) => ({ id: f.id, contentHash: f.contentHash })),
    plans: plans.map((p) => ({ id: p.id, contentHash: p.contentHash, active: true })),
  };
}

describe('parseCatalog', () => {
  it('accepte le catalogue livré : le Zod suit schema.json', () => {
    const catalog = parseCatalog(PROP_FIRM_CATALOG_FILES);
    expect(catalog.map((f) => f.firm.id)).toEqual(FIRM_IDS);
    expect(catalog.reduce((n, f) => n + f.plans.length, 0)).toBe(PLAN_COUNT);
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
    expect(() => parseCatalog([...files, twin])).toThrow(`firm en double : ${files[1].firm.id}`);
  });
});

describe('cohérence du catalogue', () => {
  it('chaque firm a une date de relevé valide, pas dans le futur', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const f of RAW) {
      expect(f.verified_at, f.firm.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(f.verified_at)), f.firm.id).toBe(false);
      expect(f.verified_at <= today, f.firm.id).toBe(true);
    }
  });

  it('chaque plan cite au moins une source https et est préfixé par sa firm', () => {
    for (const f of RAW) {
      for (const p of f.plans) {
        expect(p.id.startsWith(`${f.firm.id}-`), p.id).toBe(true);
        expect(p.source_urls.length, p.id).toBeGreaterThan(0);
        for (const url of p.source_urls) expect(url, p.id).toMatch(/^https:\/\//);
      }
    }
  });

  it('champs obligatoires : taille, au moins une phase, max contrats renseigné', () => {
    for (const f of RAW) {
      for (const p of f.plans) {
        expect(p.account_size, p.id).toBeGreaterThan(0);
        expect(p.phases.length, p.id).toBeGreaterThan(0);
        for (const ph of p.phases) expect(ph.max_contracts, `${p.id} ${ph.phase}`).not.toBeUndefined();
      }
    }
  });

  it('notation des contrats : micros = 10 × minis, sauf exceptions listées et justifiées', () => {
    const offenders: string[] = [];
    const used = new Set<number>();
    for (const f of RAW) {
      for (const p of f.plans) {
        for (const ph of p.phases) {
          const mc = ph.max_contracts;
          if (!mc) continue;
          for (const { minis, micros } of [mc, ...(mc.tiers ?? [])]) {
            for (const n of [minis, micros]) if (n != null) expect(Number.isInteger(n) && n > 0, `${p.id} ${ph.phase}`).toBe(true);
            if (minis == null || micros == null || micros === minis * 10) continue;
            const i = CONTRACT_NOTATION_EXCEPTIONS.findIndex((e) => e.match.test(p.id) && (e.phase == null || e.phase === ph.phase));
            if (i === -1) offenders.push(`${p.id} ${ph.phase} : ${minis} minis / ${micros} micros`);
            else used.add(i);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
    // Une exception devenue inutile est retirée de la liste plutôt que gardée « au cas où ».
    expect([...used].sort()).toEqual(CONTRACT_NOTATION_EXCEPTIONS.map((_, i) => i));
  });
});

describe('toRows', () => {
  const { firms, plans } = toRows(parseCatalog(PROP_FIRM_CATALOG_FILES));

  it('une ligne par firm et par plan, date du relevé reprise du fichier', () => {
    expect(firms.map((f) => f.id)).toEqual(FIRM_IDS);
    expect(plans).toHaveLength(PLAN_COUNT);
    for (const [i, f] of RAW.entries()) expect(firms[i].verifiedAt).toEqual(new Date(`${f.verified_at}T00:00:00Z`));
  });

  it('mappe les colonnes de requête et garde les règles au format du catalogue', () => {
    const byId = new Map(plans.map((p) => [p.id, p]));
    for (const f of RAW) {
      for (const p of f.plans) {
        const row = byId.get(p.id)!;
        expect(row).toMatchObject({ firmId: f.firm.id, accountSize: p.account_size, active: true });
        expect(row.phases).toEqual(p.phases);
      }
    }
  });

  it('empreinte stable entre deux lectures, sensible au moindre changement de règle', () => {
    const again = toRows(parseCatalog(clone(PROP_FIRM_CATALOG_FILES))).plans;
    expect(again.map((p) => p.contentHash)).toEqual(plans.map((p) => p.contentHash));

    const files = clone(PROP_FIRM_CATALOG_FILES) as { plans: { id: string; phases: { max_drawdown: { amount: number } }[] }[] }[];
    const target = files[1].plans[0];
    target.phases[0].max_drawdown.amount += 1;
    const changed = toRows(parseCatalog(files)).plans.find((p) => p.id === target.id)!;
    expect(changed.contentHash).not.toBe(plans.find((p) => p.id === target.id)!.contentHash);
  });

  it('contentHash dépend du contenu, pas de l’instance', () => {
    expect(contentHash({ a: 1 })).toBe(contentHash({ a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});

describe('planCatalogSync', () => {
  const catalog = parseCatalog(PROP_FIRM_CATALOG_FILES);
  const firstPlanId = RAW[1].plans[0].id;

  it('base vide : crée toutes les firms et tous les plans', () => {
    const plan = planCatalogSync(catalog, { firms: [], plans: [] });
    expect(plan.firmsToCreate).toHaveLength(FIRM_IDS.length);
    expect(plan.plansToCreate).toHaveLength(PLAN_COUNT);
    expect(plan.firmsToUpdate).toEqual([]);
    expect(plan.plansToUpdate).toEqual([]);
    expect(plan.planIdsToDeactivate).toEqual([]);
  });

  it('base déjà alignée : aucune écriture', () => {
    expect(isNoop(planCatalogSync(catalog, syncedState(PROP_FIRM_CATALOG_FILES)))).toBe(true);
  });

  it('règle modifiée : met à jour ce plan seulement', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.find((p) => p.id === firstPlanId)!.contentHash = 'ancienne';
    const plan = planCatalogSync(catalog, state);
    expect(plan.plansToUpdate.map((p) => p.id)).toEqual([firstPlanId]);
    expect(plan.plansToCreate).toEqual([]);
  });

  it('relevé d’une firm modifié : met à jour la firm', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.firms[0].contentHash = 'ancienne';
    expect(planCatalogSync(catalog, state).firmsToUpdate.map((f) => f.id)).toEqual([FIRM_IDS[0]]);
  });

  it('plan retiré du catalogue : désactivé, jamais supprimé', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.push({ id: 'test-retire-50k', contentHash: 'x', active: true });
    const plan = planCatalogSync(catalog, state);
    expect(plan.planIdsToDeactivate).toEqual(['test-retire-50k']);
  });

  it('plan déjà désactivé et toujours absent : rien à faire', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.push({ id: 'test-retire-50k', contentHash: 'x', active: false });
    expect(isNoop(planCatalogSync(catalog, state))).toBe(true);
  });

  it('plan revenu dans le catalogue après un retrait : réactivé même à contenu égal', () => {
    const state = syncedState(PROP_FIRM_CATALOG_FILES);
    state.plans.find((p) => p.id === firstPlanId)!.active = false;
    const plan = planCatalogSync(catalog, state);
    expect(plan.plansToUpdate.map((p) => [p.id, p.active])).toEqual([[firstPlanId, true]]);
  });
});
