import type { CompactFirm, CompactPhase, CompactPlan } from '../data/prop-firm-rules-view';

/**
 * Sélecteur firm → plan → phase des règles prop firm, SANS le DOM : la même logique sert au
 * rendu serveur (sélection par défaut) et aux scripts de chaque page qui l'affiche (home
 * `PropFirmLive.astro`, `/prop-firm`). Chaque page garde son balisage et rend ce qu'on lui passe.
 */

/** « 7 oct. 2026 » : date de relevé des règles, lue dans le catalogue. */
export const verifiedLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** « Règles officielles Apex, relevées le 7 oct. 2026. » */
export const sourceLabel = (firm: CompactFirm) =>
  `Règles officielles ${firm.name}, relevées le ${verifiedLabel(firm.verifiedAt)}.`;

/** Plan montré quand on choisit une firm : le 50K, sinon le premier. */
export const defaultPlan = (firm: CompactFirm): CompactPlan =>
  firm.plans.find((p) => p.size === 50000) ?? firm.plans[0];

/** Sélection à l'ouverture : le plan des captures (Apex 50K EOD), sinon le premier du catalogue. */
export function initialSelection(catalog: CompactFirm[]): { firm: CompactFirm; plan: CompactPlan } {
  const firm = catalog.find((f) => f.id === 'apex') ?? catalog[0];
  const plan = firm.plans.find((p) => p.size === 50000 && /EOD/.test(p.label)) ?? firm.plans[0];
  return { firm, plan };
}

export interface PickerState {
  firm: CompactFirm;
  plan: CompactPlan;
  /** Index dans `plan.phases`. */
  phase: number;
}

/** Ce qui a changé : la page reconstruit la liste des plans (`firm`), les phases (`plan`) ou seulement les règles. */
export type PickerChange = 'firm' | 'plan' | 'phase';

export interface PropFirmPicker {
  readonly state: PickerState;
  readonly current: CompactPhase;
  selectFirm(id: string): void;
  selectPlan(id: string): void;
  selectPhase(index: number): void;
  /** Rend l'état courant comme après un choix de plan (phases + règles). */
  refresh(): void;
}

export function createPropFirmPicker(
  catalog: CompactFirm[],
  start: { firmId?: string; planId?: string },
  render: (state: PickerState, change: PickerChange) => void,
): PropFirmPicker {
  const firm = catalog.find((f) => f.id === start.firmId) ?? catalog[0];
  const state: PickerState = {
    firm,
    plan: firm.plans.find((p) => p.id === start.planId) ?? firm.plans[0],
    phase: 0,
  };
  return {
    state,
    get current() {
      return state.plan.phases[state.phase];
    },
    selectFirm(id) {
      const next = catalog.find((f) => f.id === id);
      if (!next) return;
      state.firm = next;
      state.plan = defaultPlan(next);
      state.phase = 0;
      render(state, 'firm');
    },
    selectPlan(id) {
      state.plan = state.firm.plans.find((p) => p.id === id) ?? state.plan;
      state.phase = 0;
      render(state, 'plan');
    },
    selectPhase(index) {
      if (index < 0 || index >= state.plan.phases.length) return;
      state.phase = index;
      render(state, 'phase');
    },
    refresh() {
      state.phase = 0;
      render(state, 'plan');
    },
  };
}
