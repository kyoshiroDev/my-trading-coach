import { founderSeatsLabel } from '@mtc/shared';
import { isSelling, onFounderState, rememberedCta } from './founder-offer';

/**
 * Carte Fondateur d'une section de tarifs (#525), côté navigateur. UN seul mécanisme pour toutes
 * les pages qui affichent les tarifs (home `Pricing.astro`, `/prop-firm`) : mêmes règles
 * d'affichage, même compteur, même retrait automatique.
 *
 * Balisage attendu dans `section` :
 * - carte `[data-founder-card]` rendue au build (offre ouverte au build), ou gabarit
 *   `template[data-founder-tpl]` (fermée au build) ; idem pour la note (`[data-founder-note]`,
 *   `template[data-founder-note-tpl]`) ;
 * - dans la carte : `[data-founder-cta]` (lien d'achat), `[data-founder-left]` (libellé du
 *   compteur), `.founder-seats` (`.is-pending` jusqu'au vrai chiffre), `.founder-seats-fill` ;
 * - carte Premium `.is-premium` : son lien `/register` sert de modèle aux paramètres de suivi ;
 * - classe `has-founder` sur la section quand la carte est là (3 colonnes, Premium non mis en avant).
 */
export function initFounderPricing(section: HTMLElement | null): void {
  if (!section) return;
  const cardTpl = section.querySelector<HTMLTemplateElement>('template[data-founder-tpl]');
  const noteTpl = section.querySelector<HTMLTemplateElement>('template[data-founder-note-tpl]');

  const clone = (t: HTMLTemplateElement) =>
    (t.content.cloneNode(true) as DocumentFragment).firstElementChild as HTMLElement;

  /** Paramètres posés par Base.astro sur les liens /register (ref, promo, utm_*) : la carte,
   *  insérée après eux, les reprend du lien Premium (sauf `plan`). */
  const copyTrackingParams = (to: HTMLAnchorElement) => {
    const from = section.querySelector<HTMLAnchorElement>('.is-premium a[href*="/register"]');
    if (!from) return;
    const src = new URL(from.href);
    const dst = new URL(to.href);
    src.searchParams.forEach((v, k) => {
      if (k !== 'plan' && !dst.searchParams.has(k)) dst.searchParams.set(k, v);
    });
    to.href = dst.toString();
  };

  /** Lien de la carte : paramètres de suivi et point de clic (une seule fois par carte). */
  const wire = (card: HTMLElement) => {
    const cta = card.querySelector<HTMLAnchorElement>('[data-founder-cta]');
    if (!cta || cta.dataset.wired) return;
    cta.dataset.wired = '1';
    copyTrackingParams(cta);
    // Point de clic : bandeau, FAQ ou campagne e-mail s'ils ont mené ici, sinon la carte elle-même.
    cta.addEventListener('click', () => {
      const remembered = rememberedCta();
      if (remembered === 'bandeau' || remembered === 'faq' || remembered === 'email') {
        const url = new URL(cta.href);
        url.searchParams.set('cta', remembered);
        cta.href = url.toString();
      }
    });
  };

  /** Carte déjà rendue (offre ouverte au build) ou insérée depuis son gabarit. */
  const mount = (): HTMLElement | null => {
    let card = section.querySelector<HTMLElement>('[data-founder-card]');
    if (!card && cardTpl) {
      card = clone(cardTpl);
      cardTpl.after(card);
      if (noteTpl) noteTpl.after(clone(noteTpl));
    }
    if (card) wire(card);
    return card;
  };

  const unmount = () => {
    section.querySelector('[data-founder-card]')?.remove();
    section.querySelector('[data-founder-note]')?.remove();
    section.classList.remove('has-founder');
    // Éléments rendus au build seulement si l'offre vendait (bouton du Hero…).
    document.querySelectorAll('[data-founder-only]').forEach((el) => el.remove());
  };

  // Carte rendue au build (offre ouverte à ce moment-là) : seule une réponse EXPLICITE « ne vend
  // plus » la retire. API injoignable ou réponse invalide (`null`) → la carte reste, compteur masqué :
  // pas de saut de mise en page, et le serveur refuse de toute façon un checkout fondateur si l'offre
  // est fermée ou complète (`FounderOfferService.eligibility` + réservation sous verrou).
  const builtOpen = !!section.querySelector('[data-founder-card]');
  if (!cardTpl && !builtOpen) return;
  onFounderState((s) => {
    if (s === null && builtOpen) return;
    if (!isSelling(s)) return unmount();
    const card = mount();
    if (!card) return;
    section.classList.add('has-founder');
    const left = card.querySelector('[data-founder-left]');
    if (left) left.textContent = founderSeatsLabel(s.seatsLeft, s.seatsTotal) ?? '';
    const fill = card.querySelector<HTMLElement>('.founder-seats-fill');
    if (fill) fill.style.transform = `scaleX(${(s.seatsTotal - s.seatsLeft) / s.seatsTotal})`;
    card.querySelector('.founder-seats')?.classList.remove('is-pending');
  });
}
