// Configuration commune des scénarios k6 (SCA-B0-10).
// Cible OBLIGATOIRE par variable, jamais la prod par défaut.
import http from 'k6/http';
import { check } from 'k6';

export const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!BASE_URL) {
  throw new Error('BASE_URL requis, ex. BASE_URL=https://beta.api.mytradingcoach.app/api');
}
if (/\/\/api\.mytradingcoach\.app/.test(BASE_URL) && __ENV.ALLOW_PROD !== 'oui-je-sais') {
  throw new Error('Cible = PROD refusée. Tester contre beta (voir README).');
}

// SCA-B9 : avec LOAD_TEST_KEY (= celle de .env.beta), l'API compte chaque VU comme un client
// distinct au lieu de tout compter sur l'IP de l'injecteur. Sans elle : comptage par IP (README).
const loadHeaders = () =>
  __ENV.LOAD_TEST_KEY ? { 'x-load-test-key': __ENV.LOAD_TEST_KEY, 'x-load-client': `vu-${__VU}` } : {};
const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...loadHeaders() });
export const auth = (token) => ({ headers: { ...jsonHeaders(), Authorization: `Bearer ${token}` } });

/** Email unique par itération (préfixe reconnaissable, à purger après le test). */
export function uniqueEmail(tag) {
  return `load-${tag}-${Date.now()}-${__VU}-${__ITER}-${Math.floor(Math.random() * 1e6)}@test.local`;
}

export function register(email, password = 'LoadTest-2026!') {
  const res = http.post(`${BASE_URL}/auth/register`, JSON.stringify({ email, password, name: 'Load Test' }), {
    headers: jsonHeaders(),
    tags: { name: 'POST /auth/register' },
  });
  check(res, { 'register 201': (r) => r.status === 201 });
  return res.status === 201 ? res.json('data.access_token') : null;
}

export function login(email, password) {
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email, password }), {
    headers: jsonHeaders(),
    tags: { name: 'POST /auth/login' },
  });
  check(res, { 'login 2xx': (r) => r.status === 200 || r.status === 201 });
  return res.status < 300 ? res.json('data.access_token') : null;
}

/** GET authentifié, taggé par route (regroupement des métriques k6). */
export function get(token, path, name = `GET ${path}`) {
  const res = http.get(`${BASE_URL}${path}`, { ...auth(token), tags: { name } });
  check(res, { [`${name} 200`]: (r) => r.status === 200 });
  return res;
}

/** Ouverture du tableau de bord : les appels du dashboard Angular. */
export function openDashboard(token) {
  if (get(token, '/auth/me').status === 401) return 401; // jeton expiré : le VU se reconnecte
  get(token, '/analytics/summary');
  get(token, '/analytics/equity-curve');
  get(token, '/analytics/by-setup');
  get(token, '/analytics/top-assets');
  get(token, '/analytics/activity/current-month');
  get(token, '/session/active');
}

/** Ouverture du journal : première page + stats. */
export function openJournal(token) {
  get(token, '/trades?limit=50', 'GET /trades'); // pagination par cursor, pas de « page »
  get(token, '/trades/stats');
}

/** Un tour de polling en session active (stats 30 s, contexte marché 15 s). */
export function sessionPoll(token) {
  get(token, '/session/today/stats');
  get(token, '/market/context');
}
