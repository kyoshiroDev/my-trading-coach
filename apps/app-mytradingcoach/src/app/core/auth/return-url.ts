/**
 * Page demandée avant la connexion (#994, audit fonctionnel) : lien d'e-mail ou de notification
 * ouvert déconnecté → retrouvé après la connexion (e-mail ou Google), au lieu du tableau de bord.
 *
 * `sessionStorage` (onglet courant) : le retour Google passe par un service sans accès à la route.
 * Seul un chemin interne de l'app est accepté : jamais d'URL absolue ni `//hote` (redirection ouverte).
 */
const KEY = 'mtc.returnUrl';

export function isSafeReturnUrl(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.includes('\\') &&
    !/^\/(login|register|forgot-password|reset-password)(\/|\?|$)/.test(url)
  );
}

export function rememberReturnUrl(url: string): void {
  if (!isSafeReturnUrl(url) || url === '/' || url.startsWith('/dashboard')) return;
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    /* stockage indisponible : on retombera sur le tableau de bord */
  }
}

/** Lit et efface la page mémorisée ; null si absente ou refusée. */
export function takeReturnUrl(): string | null {
  try {
    const url = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSafeReturnUrl(url) ? url : null;
  } catch {
    return null;
  }
}
