/**
 * Engagement sur la landing (défilement, temps passé, sélecteur de règles), mesuré SANS cookie ni
 * donnée personnelle : mêmes compteurs agrégés que le parcours d'inscription (`FunnelEventDaily`,
 * colonne `path`), envoyés par `POST /public/funnel`. Un seul envoi par seuil et par chargement de
 * page. Listes FERMÉES partagées par la landing, l'API et l'admin.
 */

/** Étapes d'engagement acceptées par `POST /public/funnel`, en plus de celles de l'inscription. */
export const LANDING_ENGAGEMENT_STEPS = ['scroll_depth', 'time_on_page', 'rules_use'] as const;
export type LandingEngagementStep = (typeof LANDING_ENGAGEMENT_STEPS)[number];

/** Pages mesurées : l'accueil et la page de la pub, pour les comparer. */
export const LANDING_ENGAGEMENT_PAGES = ['/', '/prop-firm'] as const;
export type LandingEngagementPage = (typeof LANDING_ENGAGEMENT_PAGES)[number];

/** Seuils de défilement, en % de la hauteur de la page (`detail` de `scroll_depth`). */
export const LANDING_SCROLL_THRESHOLDS = [25, 50, 75, 100] as const;

/** Seuils de temps passé, en secondes d'onglet visible (`detail` de `time_on_page`). */
export const LANDING_TIME_THRESHOLDS = [10, 30, 60] as const;

export function isLandingEngagementStep(step: string): step is LandingEngagementStep {
  return (LANDING_ENGAGEMENT_STEPS as readonly string[]).includes(step);
}

/** Page mesurée d'après son chemin (`/prop-firm/` → `/prop-firm`), sinon `null`. */
export function landingEngagementPage(path: string | null | undefined): LandingEngagementPage | null {
  const p = (path ?? '').trim().replace(/\/+$/, '') || '/';
  return (LANDING_ENGAGEMENT_PAGES as readonly string[]).includes(p) ? (p as LandingEngagementPage) : null;
}

/**
 * Part de la page vue, en % (0 à 100) : bas de l'écran / hauteur du document. À moins de 4 px du bas
 * → 100 (barre d'adresse mobile, arrondis). Document vide → 0.
 */
export function scrollDepthPercent(scrollTop: number, viewportHeight: number, documentHeight: number): number {
  if (documentHeight <= 0) return 0;
  const bottom = scrollTop + viewportHeight;
  if (documentHeight - bottom < 4) return 100;
  return Math.max(0, Math.min(100, Math.floor((bottom / documentHeight) * 100)));
}
