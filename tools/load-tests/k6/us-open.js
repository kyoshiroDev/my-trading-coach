// Scénario k6 « ouverture US » (PROMPT-136) : 100 → 250 → 500 → 1 000 users simultanés.
//
// JAMAIS contre la prod. Le script refuse toute BASE_URL qui ne vise pas localhost, dev ou beta.
//
//   k6 run -e BASE_URL=http://localhost:3000/api tools/load-tests/k6/us-open.js
//   k6 run -e BASE_URL=... -e STAGE_MIN=1 ...            # paliers raccourcis (smoke)
//
// Chaque VU = un trader connecté pendant la fenêtre 15h30–17h30. Il reproduit le parcours et le
// polling RÉELS du front (constantes de apps/app-mytradingcoach/.../polling.const.ts et
// session.store.ts) :
//   - à la connexion : login + chargement du dashboard (6 appels analytics) + session active,
//   - en continu (compagnon, session ACTIVE) : live-price 4 s (60 % des users ont la saisie rapide
//     ouverte), market/context 15 s, session/today/stats 30 s, auth/me 30 s, eco range + pins 60 s,
//   - une navigation par minute : journal, stats, saisie d'un trade, analytics, Mes comptes, setups.
//
// Users : lt_u_00001 … (seed tools/load-tests/seed). VU n → loadtest-0000n@loadtest.invalid.
// Chaque VU a sa propre IP (X-Forwarded-For) : le throttler compte par IP, comme en vrai.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://localhost:3000/api';
if (!/^(https?:\/\/(localhost|127\.0\.0\.1)|https:\/\/(dev|beta)\.)/.test(BASE) || /\/\/(api|app)\.mytradingcoach/.test(BASE)) {
  throw new Error(`BASE_URL refusée (${BASE}) : uniquement localhost, dev.* ou beta.*`);
}
const PASSWORD = __ENV.LOAD_PASSWORD || 'LoadTest!2026';
const STAGE_MIN = Number(__ENV.STAGE_MIN || 5);
// Mode « session déjà ouverte » (réaliste à 15h30 : la plupart des traders ont un refresh token
// de 7 jours et ne retapent pas leur mot de passe). TOKENS_FILE = JSON [jeton du VU 1, …], signés
// avec le JWT_SECRET de l'environnement de test (JAMAIS celui de la prod). LOGIN_RATIO = part des
// VU qui font un vrai login argon2 (défaut 0,1).
const TOKENS = __ENV.TOKENS_FILE ? JSON.parse(open(__ENV.TOKENS_FILE)) : null;
const LOGIN_RATIO = Number(__ENV.LOGIN_RATIO || 0.1);
const RAMP_MIN = Number(__ENV.RAMP_MIN || 1);
// Paliers (VU) : TARGETS=500,1000 pour un passage court.
const TARGETS = (__ENV.TARGETS || '100,250,500,1000').split(',').map(Number);
// Endpoints à sauter (noms k6, séparés par des virgules) : simule le coût d'un endpoint après
// correctif sans modifier l'API (ex. EXCLUDE=setups,session_today pour estimer le gain de P0-1).
const EXCLUDE = new Set((__ENV.EXCLUDE || '').split(',').filter(Boolean));

export const options = {
  scenarios: {
    us_open: {
      executor: 'ramping-vus',
      startVUs: 0,
      gracefulRampDown: '30s',
      stages: [
        ...TARGETS.flatMap((target) => [
          { duration: `${RAMP_MIN}m`, target }, { duration: `${STAGE_MIN}m`, target },
        ]),
        { duration: '30s', target: 0 },
      ],
    },
  },
  // Seuils de réussite de l'audit. Pas d'abortOnFail : on veut voir le palier où ça casse.
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<500'],
    'http_req_duration{kind:write}': ['p(95)<1000'],
    http_req_failed: ['rate<0.005'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max', 'count'],
  discardResponseBodies: true,
};

const loginDur = new Trend('login_duration', true);
const throttled = new Counter('throttled_429');
const errors = new Rate('app_errors');

// État par VU
let token = null;
let setupId = null;
let accountId = null;

function ip() {
  const n = __VU;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

function headers() {
  const h = { 'Content-Type': 'application/json', 'X-Forwarded-For': ip() };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function req(method, path, name, kind, body) {
  if (EXCLUDE.has(name)) return { status: 200, timings: { duration: 0 }, json: () => null };
  const params = { headers: headers(), tags: { name, kind }, responseType: 'none' };
  if (name === 'login' || name === 'setups' || name === 'accounts') params.responseType = 'text';
  let res = http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, params);
  if (res.status === 401 && name !== 'login') {
    // Jeton d'accès expiré (15 min) : le front appelle /auth/refresh ; ici on se reconnecte.
    login();
    params.headers = headers();
    res = http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, params);
  }
  if (res.status === 429) throttled.add(1);
  errors.add(res.status >= 400 || res.status === 0);
  return res;
}

function login() {
  const email = `loadtest-${String(__VU).padStart(5, '0')}@loadtest.invalid`;
  token = null;
  const res = req('POST', '/auth/login', 'login', 'write', { email, password: PASSWORD });
  loginDur.add(res.timings.duration);
  if (check(res, { 'login 2xx': (r) => r.status === 200 || r.status === 201 })) {
    token = res.json('data.access_token');
  }
}

// Seed : un user sur 20 est PREMIUM (lt_u_00020, lt_u_00040…).
function isPremium() { return __VU % 20 === 0; }

function isoDay(d) { return d.toISOString().slice(0, 10); }

function dashboard() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86400_000);
  // Le front envoie `to` à la milliseconde (comportement actuel, cf. rapport : cache inopérant).
  const range = `?from=${from.toISOString()}&to=${to.toISOString()}`;
  req('GET', `/analytics/summary${range}`, 'analytics_summary', 'read');
  req('GET', `/analytics/equity-curve/daily${range}`, 'analytics_equity_daily', 'read');
  req('GET', `/analytics/activity/range${range}`, 'analytics_activity_range', 'read');
  // Comme le front : by-setup / by-emotion seulement pour les PREMIUM (1 user sur 20 dans le seed).
  if (isPremium()) {
    req('GET', '/analytics/by-setup', 'analytics_by_setup', 'read');
    req('GET', '/analytics/by-emotion', 'analytics_by_emotion', 'read');
  }
  req('GET', '/analytics/top-assets', 'analytics_top_assets', 'read');
  req('GET', '/session/today', 'session_today', 'read');
  req('GET', '/analytics/daily-recap/yesterday', 'daily_recap_yesterday', 'read');
}

function ecoPoll() {
  const now = new Date();
  const monday = new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86400_000);
  const friday = new Date(monday.getTime() + 4 * 86400_000);
  req('GET', `/eco-calendar/range?from=${isoDay(monday)}&to=${isoDay(friday)}`, 'eco_range', 'read');
  req('GET', '/eco-calendar/pins', 'eco_pins', 'read');
}

function navigate() {
  const r = Math.random();
  if (r < 0.30) {
    req('GET', '/trades?limit=50', 'trades_list', 'read');
    req('GET', '/trades/stats', 'trades_stats', 'read');
  } else if (r < 0.50) {
    req('POST', '/trades', 'trade_create', 'write', {
      asset: 'NQ', side: Math.random() < 0.5 ? 'LONG' : 'SHORT',
      entry: 18500, exit: 18510, stopLoss: 18480, pnl: 200, quantity: 1,
      setupId, accountId, session: 'NEW_YORK', timeframe: '1m', emotion: 'FOCUSED',
    });
  } else if (r < 0.65) {
    dashboard();
  } else if (r < 0.75) {
    req('GET', '/analytics/summary', 'analytics_summary_all', 'read');
    if (isPremium()) req('GET', '/analytics/by-hour', 'analytics_by_hour', 'read');
  } else if (r < 0.85) {
    req('GET', '/accounts', 'accounts', 'read');
  } else if (r < 0.90) {
    req('GET', '/setups', 'setups', 'read');
  }
}

export default function () {
  if (!token) {
    // Arrivée étalée : tout le monde n'ouvre pas l'app à la même seconde.
    sleep(Math.random() * 10);
    if (TOKENS && TOKENS[__VU - 1] && (__VU % Math.round(1 / LOGIN_RATIO)) !== 0) {
      token = TOKENS[__VU - 1];
      req('GET', '/auth/me', 'auth_me', 'read'); // ce que fait le front au démarrage
    } else {
      login();
    }
    if (!token) { sleep(5); return; }
    const s = req('GET', '/setups', 'setups', 'read');
    try { setupId = s.json('data.0.id'); } catch (e) { setupId = null; }
    const a = req('GET', '/accounts', 'accounts', 'read');
    try { accountId = a.json('data.0.id') || a.json('data.accounts.0.id'); } catch (e) { accountId = undefined; }
    // Repli sur les ids du seed (ex. quand `setups` est dans EXCLUDE).
    const n = String(__VU).padStart(5, '0');
    setupId = setupId || `lt_s_${n}_1`;
    accountId = accountId || `lt_a_${n}_1`;
    dashboard();
    ecoPoll();
  }

  // Une « minute » de compagnon temps réel, découpée en ticks de 4 s (live-price).
  const hasQuickTrade = __VU % 10 < 6;
  const navAt = Math.floor(Math.random() * 15);
  for (let tick = 0; tick < 15; tick++) {
    const s = tick * 4;
    if (hasQuickTrade) req('GET', '/market/live-price?symbol=NQ', 'live_price', 'read');
    if (s % 16 === 0) req('GET', '/market/context', 'market_context', 'read');
    if (s % 32 === 0) {
      req('GET', '/session/today/stats', 'session_today_stats', 'read');
      req('GET', '/auth/me', 'auth_me', 'read');
    }
    if (tick === navAt) navigate();
    sleep(4);
  }
  ecoPoll();
}
