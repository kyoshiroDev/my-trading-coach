// Pic d'usage : montée jusqu'à 1 500 utilisateurs connectés (heures de marché US).
// Comptes de charge PRÉ-EXISTANTS (seed beta, SCA-B9-01) : LOAD_EMAIL_PATTERN contient {i}.
// ⚠️ Depuis UNE IP, le throttler global (60 req/min/IP) plafonne tout avant l'API : lancer après
// SCA-B3-03 (limite par utilisateur) ou avec plusieurs IP d'injection (voir README).
import { sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, login, openDashboard, openJournal, sessionPoll } from './common.js';

const USERS = Number(__ENV.LOAD_USER_COUNT || 20);
const PATTERN = __ENV.LOAD_EMAIL_PATTERN || 'load-{i}@test.local';
const PASSWORD = __ENV.LOAD_PASSWORD || 'LoadTest-2026!';

export const options = {
  stages: [
    { duration: '2m', target: 200 }, { duration: '3m', target: 200 },
    { duration: '2m', target: 500 }, { duration: '3m', target: 500 },
    { duration: '2m', target: 1000 }, { duration: '3m', target: 1000 },
    { duration: '2m', target: 1500 }, { duration: Number(__ENV.HOLD_MIN || 15) + 'm', target: 1500 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<300'],
    'http_req_failed': ['rate<0.001'],
  },
};

// Connexion une seule fois par compte, jetons partagés entre VU (la connexion est limitée par IP).
export function setup() {
  const tokens = [];
  for (let i = 1; i <= USERS; i++) {
    const t = login(PATTERN.replace('{i}', String(i)), PASSWORD);
    if (t) tokens.push(t);
  }
  if (tokens.length === 0) throw new Error('Aucun compte de charge connecté : lancer le seed beta (SCA-B9-01).');
  return { tokens };
}

export default function (data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  http.get(`${BASE_URL}/public/stats`, { tags: { name: 'GET /public/stats' } });
  openDashboard(token);
  for (let i = 0; i < 4; i++) {
    sessionPoll(token);
    sleep(15); // rythme réel du polling de session
  }
  openJournal(token);
  sleep(5 + Math.random() * 10);
}
