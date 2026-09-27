import { DEFAULT_ACCOUNT_CURRENCY, isAccountCurrency } from '@mtc/shared';
import type { OnboardingProgress, Step } from './onboarding.model';

/**
 * Progression du wizard, conservée localement.
 *
 * Le wizard bloque toutes les routes tant qu'il n'est pas terminé — c'est voulu —
 * mais un simple rechargement repartait à l'étape 1 : marché, objectif et capital
 * étaient à ressaisir, puisque rien n'est persisté côté serveur avant l'étape 5.
 * Un débutant interrompu (onglet fermé, réseau, curiosité) payait plein pot.
 */
const PROGRESS_KEY = 'mtc.onboarding.progress';

/** Enregistre la progression (stockage indisponible, ex. navigation privée : on ignore). */
export function saveProgress(snapshot: OnboardingProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
  } catch { /* stockage indispo (mode privé) : on dégrade sans bruit */ }
}

export function clearProgress(): void {
  try { localStorage.removeItem(PROGRESS_KEY); } catch { /* rien à nettoyer */ }
}

/**
 * Progression enregistrée, normalisée (chaque champ absent ou invalide reprend sa valeur par
 * défaut). `null` si rien n'est enregistré, si le snapshot est illisible ou si l'étape est hors
 * bornes : l'utilisateur repart alors proprement de l'étape 1.
 */
export function loadProgress(): OnboardingProgress | null {
  let raw: string | null = null;
  try { raw = localStorage.getItem(PROGRESS_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<OnboardingProgress>;
    const step = p.step;
    if (typeof step !== 'number' || step < 1 || step > 9) return null;
    return {
      step: step as Step,
      market: p.market ?? null,
      goal: p.goal ?? null,
      currency: isAccountCurrency(p.currency) ? p.currency : DEFAULT_ACCOUNT_CURRENCY,
      capital: typeof p.capital === 'string' ? p.capital : '',
      accountMode: p.accountMode === 'PROPFIRM' ? 'PROPFIRM' : 'PERSO',
      broker: typeof p.broker === 'string' ? p.broker : '',
      profitTarget: typeof p.profitTarget === 'string' ? p.profitTarget : '',
      maxDrawdown: typeof p.maxDrawdown === 'string' ? p.maxDrawdown : '',
      drawdownType: p.drawdownType === 'STATIC' ? 'STATIC' : 'TRAILING',
      style: p.style ?? null,
      strategy: typeof p.strategy === 'string' ? p.strategy : '',
      sessions: Array.isArray(p.sessions) ? p.sessions : [],
      assets: Array.isArray(p.assets) ? p.assets : [],
      favorite: p.favorite ?? null,
    };
  } catch {
    return null; // snapshot illisible
  }
}
