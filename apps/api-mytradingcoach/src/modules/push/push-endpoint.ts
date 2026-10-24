/**
 * Adresses d'abonnement acceptées (#717, revue I1). L'API envoie une requête HTTP à l'adresse que le
 * navigateur lui a donnée : sans liste blanche, un compte pourrait la faire pointer vers le réseau
 * interne. Fonctions PURES, vérifiées à l'abonnement (DTO) ET avant chaque envoi (lignes en base).
 *
 * HTTPS seulement, port 443, ni identifiants dans l'URL ni IP littérale : seulement les services
 * push des navigateurs (Chrome et Edge via FCM, Firefox, Safari, ancien Edge via WNS).
 */

/** Hôtes exacts. */
const EXACT_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'] as const;
/** Domaines dont seuls les SOUS-domaines sont acceptés (`web.push.apple.com`, `wns2-par02p.notify.windows.com`). */
const HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'] as const;

/** Hôte de l'adresse s'il est accepté, sinon la raison du refus (jamais l'adresse complète). */
export function pushEndpointCheck(endpoint: string): { ok: true } | { ok: false; reason: string; host: string } {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { ok: false, reason: 'adresse illisible', host: '?' };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:') return { ok: false, reason: 'HTTPS obligatoire', host };
  if (url.username || url.password) return { ok: false, reason: 'identifiants dans l’adresse', host };
  if (url.port !== '' && url.port !== '443') return { ok: false, reason: 'port non autorisé', host };
  const allowed =
    (EXACT_HOSTS as readonly string[]).includes(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
  return allowed ? { ok: true } : { ok: false, reason: 'service push inconnu', host };
}

export const isAllowedPushEndpoint = (endpoint: string): boolean => pushEndpointCheck(endpoint).ok;
