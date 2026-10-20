import {
  LANDING_ENGAGEMENT_PAGES,
  LANDING_SCROLL_THRESHOLDS,
  LANDING_TIME_THRESHOLDS,
  landingEngagementPage,
  type AdminLandingEngagementRow,
} from '@mtc/shared';

/** Ligne SQL de pages vues : (page, source, medium, campagne) → pages vues. */
export interface ViewGroup {
  path: string;
  source: string;
  medium: string;
  campaign: string;
  n: number;
}

/** Ligne SQL d'engagement : même clé + étape + seuil → nombre. */
export interface EngagementGroup extends Omit<ViewGroup, 'n'> {
  step: string;
  detail: string;
  n: number;
}

const MAX_ROWS = 100;
const orNull = (v: string) => v || null;
const SCROLL = LANDING_SCROLL_THRESHOLDS.map(String);
const TIME = LANDING_TIME_THRESHOLDS.map(String);

/**
 * Fusionne pages vues (LandingVisitDaily) et engagement (FunnelEventDaily) par page + source +
 * medium + campagne. Page hors `LANDING_ENGAGEMENT_PAGES`, étape ou seuil inconnus : ignorés.
 * Une ligne sans vue (engagement seul) est gardée. `''` en base → `null`.
 */
export function buildLandingEngagementRows(views: ViewGroup[], events: EngagementGroup[]): AdminLandingEngagementRow[] {
  const rows = new Map<string, AdminLandingEngagementRow>();
  const row = (g: Omit<ViewGroup, 'n'>) => {
    const path = landingEngagementPage(g.path);
    if (!path) return null;
    const key = JSON.stringify([path, g.source, g.medium, g.campaign]);
    let r = rows.get(key);
    if (!r) {
      r = {
        path,
        source: orNull(g.source),
        medium: orNull(g.medium),
        campaign: orNull(g.campaign),
        views: 0,
        scroll: SCROLL.map(() => 0),
        time: TIME.map(() => 0),
        rulesUse: 0,
      };
      rows.set(key, r);
    }
    return r;
  };
  for (const v of views) {
    const r = row(v);
    if (r) r.views += v.n;
  }
  for (const e of events) {
    const r = row(e);
    if (!r) continue;
    if (e.step === 'rules_use') r.rulesUse += e.n;
    else if (e.step === 'scroll_depth' && SCROLL.includes(e.detail)) r.scroll[SCROLL.indexOf(e.detail)] += e.n;
    else if (e.step === 'time_on_page' && TIME.includes(e.detail)) r.time[TIME.indexOf(e.detail)] += e.n;
  }
  const order = (p: string) => (LANDING_ENGAGEMENT_PAGES as readonly string[]).indexOf(p);
  return [...rows.values()]
    .sort((a, b) => order(a.path) - order(b.path) || b.views - a.views || b.scroll[0] - a.scroll[0])
    .slice(0, MAX_ROWS);
}
