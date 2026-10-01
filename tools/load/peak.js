// Pic d'usage : montée jusqu'à 1 500 utilisateurs connectés (heures de marché US).
// Comptes de charge PRÉ-EXISTANTS (seed beta, SCA-B9-01) : LOAD_EMAIL_PATTERN contient {i}.
// Depuis UNE IP : passer LOAD_TEST_KEY (voir README), sinon le throttler par IP plafonne tout.
import { sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, auth, login, openDashboard, openJournal, sessionPoll } from './common.js';

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

// Chaque VU = un compte distinct du seed (load-<n>@test.local), connecté à sa première itération
// (vague de connexions réaliste pendant la montée) et reconnecté quand son jeton (15 min) expire.
let token = null;
const myEmail = () => PATTERN.replace('{i}', String(((__VU - 1) % USERS) + 1));

export default function () {
  if (!token) token = login(myEmail(), PASSWORD);
  if (!token) { sleep(5); return; }
  http.get(`${BASE_URL}/public/stats`, { tags: { name: 'GET /public/stats' }, headers: auth(token).headers });
  if (openDashboard(token) === 401) { token = null; return; }
  for (let i = 0; i < 4; i++) {
    sessionPoll(token);
    sleep(15); // rythme réel du polling de session
  }
  openJournal(token);
  sleep(5 + Math.random() * 10);
}
