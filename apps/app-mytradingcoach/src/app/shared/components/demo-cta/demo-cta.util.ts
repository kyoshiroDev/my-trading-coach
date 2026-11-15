/**
 * Relance unique de la démo (#1029) : une fenêtre courte après 60 s dans la démo OU 3 pages vues,
 * une seule fois par visite, jamais pendant que le visiteur fait défiler ou remplit un champ.
 */
export const DEMO_RELANCE_DELAY_MS = 60_000;
export const DEMO_RELANCE_PAGES = 3;
/** Un défilement dans cette fenêtre (ms) repousse la relance. */
export const DEMO_RELANCE_SCROLL_QUIET_MS = 1_500;

/** Clés sessionStorage (une visite = un onglet). */
export const DEMO_CTA_KEYS = {
  start: 'mtc_demo_start',
  pages: 'mtc_demo_pages',
  lastPage: 'mtc_demo_last_page',
  relanceShown: 'mtc_demo_relance',
  viewSent: 'mtc_demo_cta_view',
} as const;

export interface RelanceState {
  elapsedMs: number;
  pages: number;
  alreadyShown: boolean;
  /** Défilement récent ou champ en cours de saisie. */
  busy: boolean;
  /** Une autre fenêtre est ouverte (action bloquée, offre…). */
  otherModal: boolean;
}

export function relanceDue(s: RelanceState): boolean {
  if (s.alreadyShown || s.busy || s.otherModal) return false;
  return s.elapsedMs >= DEMO_RELANCE_DELAY_MS || s.pages >= DEMO_RELANCE_PAGES;
}

/** Vrai si l'élément reçoit une saisie (champ, liste, zone éditable). */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}
