// Engagement de / et /prop-firm, sans cookie : défilement (25/50/75/100 %), temps passé onglet
// visible (10/30/60 s) et première utilisation du sélecteur de règles (`[data-track-rules]`).
// Un seul envoi par seuil et par chargement de page, par `window.mtcFunnel` (script d'acquisition
// de Base.astro) : absente en mode interne et pendant la redirection de la pub → rien n'est envoyé.
// Écouteurs passifs, calcul du défilement au plus une fois par image : rien ne ralentit la page.
import {
  LANDING_SCROLL_THRESHOLDS,
  LANDING_TIME_THRESHOLDS,
  landingEngagementPage,
  scrollDepthPercent,
  type LandingEngagementStep,
} from '@mtc/shared';

type FunnelSender = (fields: { step: LandingEngagementStep; detail?: string; path: string }) => void;

export function startEngagement(): void {
  const send = (window as Window & { mtcFunnel?: FunnelSender }).mtcFunnel;
  const path = landingEngagementPage(location.pathname);
  if (!send || !path) return;
  const track = (step: LandingEngagementStep, detail?: number) =>
    send({ step, detail: detail === undefined ? undefined : String(detail), path });

  // Défilement : seuils encore à atteindre, retirés une fois envoyés.
  let scrollLeft: number[] = [...LANDING_SCROLL_THRESHOLDS];
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const doc = document.documentElement;
      const pct = scrollDepthPercent(window.scrollY, window.innerHeight, doc.scrollHeight);
      const reached = scrollLeft.filter((t) => pct >= t);
      if (!reached.length) return;
      scrollLeft = scrollLeft.filter((t) => pct < t);
      reached.forEach((t) => track('scroll_depth', t));
      if (!scrollLeft.length) window.removeEventListener('scroll', onScroll);
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // Temps passé : seulement onglet visible, un minuteur vers le prochain seuil.
  let timeLeft: number[] = [...LANDING_TIME_THRESHOLDS];
  let visibleMs = 0;
  let since: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const elapsed = () => visibleMs + (since === null ? 0 : performance.now() - since);
  const schedule = () => {
    clearTimeout(timer);
    if (since === null || !timeLeft.length) return;
    timer = setTimeout(() => {
      const s = elapsed() / 1000;
      const reached = timeLeft.filter((t) => s >= t);
      timeLeft = timeLeft.filter((t) => s < t);
      reached.forEach((t) => track('time_on_page', t));
      schedule();
    }, Math.max(0, timeLeft[0] * 1000 - elapsed()));
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (since !== null) visibleMs += performance.now() - since;
      since = null;
    } else if (since === null) {
      since = performance.now();
    }
    schedule();
  };
  document.addEventListener('visibilitychange', onVisibility);
  onVisibility();

  // Sélecteur de règles : 1re utilisation (bouton ou liste déroulante) seulement.
  let rulesSent = false;
  const onRules = (ev: Event) => {
    const t = ev.target as Element | null;
    if (rulesSent || !t?.closest?.('[data-track-rules]')) return;
    if (ev.type === 'click' && !t.closest('button')) return;
    if (ev.type === 'change' && !(t instanceof HTMLSelectElement)) return;
    rulesSent = true;
    track('rules_use');
    document.removeEventListener('click', onRules, true);
    document.removeEventListener('change', onRules, true);
  };
  document.addEventListener('click', onRules, { capture: true, passive: true });
  document.addEventListener('change', onRules, { capture: true, passive: true });
}
