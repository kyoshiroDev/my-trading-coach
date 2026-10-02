import type { TradovateApiHosts, TradovateEnv } from './tradovate.types';

/**
 * Routage des hôtes Tradovate (doc « Dynamic API Hosts »). Les réponses d'auth portent `apiHosts`,
 * et l'hôte `demo` — celui des comptes prop firm — varie par organisation. Le 2026-10-03,
 * NinjaTrader a changé les hôtes « evaluation services » : un client qui les code en dur reçoit
 * `421` (WebSocket, sans recours) ou `307` (REST, que fetch suit SANS le jeton).
 *
 * Les constantes ci-dessous restent le REPLI explicite : connexion dont `apiHosts` n'a pas encore
 * été lu, ou réponse qui ne le porte pas. Elles restent valables pour live (inchangé selon
 * NinjaTrader).
 */
export const FALLBACK_HOSTS: Record<TradovateEnv, { api: string; reporting: string }> = {
  live: { api: 'live.tradovateapi.com', reporting: 'rpt-live.tradovateapi.com' },
  demo: { api: 'demo.tradovateapi.com', reporting: 'rpt-demo.tradovateapi.com' },
};

/** `apiHosts` relu au-delà de cet âge : l'hôte peut basculer à tout moment côté NinjaTrader. */
export const API_HOSTS_TTL_MS = 30 * 60 * 1000;

/** Nom d'hôte nu (pas de schéma, de chemin, de port ni d'identifiants). */
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function isHostname(value: unknown): value is string {
  return typeof value === 'string' && HOSTNAME.test(value);
}

/**
 * `apiHosts` exploitable, ou `null`. Seules les entrées au format d'hôte nu sont gardées : la
 * valeur part en base puis sert d'URL pour des requêtes portant le jeton.
 */
export function parseApiHosts(raw: unknown): TradovateApiHosts | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hosts: TradovateApiHosts = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isHostname(value)) hosts[key] = value.toLowerCase();
  }
  return hosts.live || hosts.demo ? hosts : null;
}

function apiHost(env: TradovateEnv, hosts?: unknown): string {
  const parsed = parseApiHosts(hosts);
  return parsed?.[env] ?? FALLBACK_HOSTS[env].api;
}

/** Base REST du compte, `/v1` inclus. */
export function restBase(env: TradovateEnv, hosts?: unknown): string {
  return `https://${apiHost(env, hosts)}/v1`;
}

/** WebSocket « données utilisateur » : même hôte que le REST du compte. */
export function wsUrl(env: TradovateEnv, hosts?: unknown): string {
  return `wss://${apiHost(env, hosts)}/v1/websocket`;
}

/** Base de la Reporting API (`reportingLive` / `reportingDemo`). */
export function reportingBase(env: TradovateEnv, hosts?: unknown): string {
  const parsed = parseApiHosts(hosts);
  const host = parsed?.[env === 'live' ? 'reportingLive' : 'reportingDemo'] ?? FALLBACK_HOSTS[env].reporting;
  return `https://${host}`;
}

/** Résumé loggable (aucun secret) des hôtes qui comptent pour MTC. */
export function describeHosts(hosts: TradovateApiHosts | null): string {
  if (!hosts) return 'aucun';
  return `live=${hosts.live ?? '?'} demo=${hosts.demo ?? '?'} rpt-live=${hosts.reportingLive ?? '?'} rpt-demo=${hosts.reportingDemo ?? '?'}`;
}

/**
 * `fetch` qui suit UNE redirection 307/308 Tradovate EN GARDANT le jeton. Filet pour une
 * connexion dont `apiHosts` est encore périmé : fetch suivrait seul la redirection, mais en
 * retirant `Authorization` (hôte différent) → 401 trompeur. Seules les cibles https au nom d'hôte
 * valide sont suivies.
 */
export async function fetchFollowingRedirect(
  url: string,
  init: RequestInit,
  onRedirect?: (from: string, to: string) => void,
): Promise<Response> {
  const res = await fetch(url, { ...init, redirect: 'manual' });
  if (res.status !== 307 && res.status !== 308) return res;
  const location = res.headers.get('location');
  if (!location) return res;
  let target: URL;
  try {
    target = new URL(location, url);
  } catch {
    return res;
  }
  if (target.protocol !== 'https:' || !isHostname(target.hostname)) return res;
  onRedirect?.(new URL(url).host, target.host);
  return fetch(target.toString(), { ...init, redirect: 'manual' });
}
