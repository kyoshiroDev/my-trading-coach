import {
  SIGNUP_FUNNEL_STEPS,
  type AdminSignupFunnelError,
  type AdminSignupFunnelRow,
  type SignupFunnelStep,
} from '@mtc/shared';

/** Ligne SQL de visites : (source, medium, campagne, navigateur intégré) → visites. */
export interface VisitGroup {
  source: string;
  medium: string;
  campaign: string;
  inApp: boolean;
  n: number;
}

/** Ligne SQL d'événements : même clé + étape → nombre. */
export interface StepGroup extends Omit<VisitGroup, 'n'> {
  step: string;
  n: number;
}

export interface ErrorGroup {
  source: string;
  inApp: boolean;
  code: string;
  n: number;
}

const MAX_ROWS = 100;
const MAX_ERRORS = 50;
const orNull = (v: string) => v || null;
const emptySteps = (): Record<SignupFunnelStep, number> =>
  Object.fromEntries(SIGNUP_FUNNEL_STEPS.map((s) => [s, 0])) as Record<SignupFunnelStep, number>;

/**
 * Fusionne visites (LandingVisitDaily) et étapes (FunnelEventDaily) par source + medium + campagne
 * + navigateur intégré. Une source sans visite (arrivée directe sur l'app) a quand même sa ligne.
 * `''` en base → `null` (non renseigné). Étape inconnue (valeur hors liste) ignorée.
 */
export function buildSignupFunnelRows(visits: VisitGroup[], steps: StepGroup[]): AdminSignupFunnelRow[] {
  const rows = new Map<string, AdminSignupFunnelRow>();
  const row = (g: Omit<VisitGroup, 'n'>) => {
    const key = JSON.stringify([g.source, g.medium, g.campaign, g.inApp]);
    let r = rows.get(key);
    if (!r) {
      r = {
        source: orNull(g.source),
        medium: orNull(g.medium),
        campaign: orNull(g.campaign),
        inApp: g.inApp,
        visits: 0,
        steps: emptySteps(),
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const v of visits) row(v).visits += v.n;
  for (const s of steps) {
    if (!(SIGNUP_FUNNEL_STEPS as readonly string[]).includes(s.step)) continue;
    row(s).steps[s.step as SignupFunnelStep] += s.n;
  }
  return [...rows.values()]
    .sort((a, b) => b.visits - a.visits || b.steps.cta_click - a.steps.cta_click)
    .slice(0, MAX_ROWS);
}

export function buildSignupFunnelErrors(groups: ErrorGroup[]): AdminSignupFunnelError[] {
  return groups
    .map((g) => ({ source: orNull(g.source), inApp: g.inApp, code: g.code || 'other', count: g.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ERRORS);
}
