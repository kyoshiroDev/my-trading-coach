// Vague d'inscriptions du jour J : 30 inscriptions/min pendant 10 min (audit C1–C4).
// ⚠️ Depuis UNE IP, la limite d'inscription (10/h/IP, SCA-B0-04) bloque dès la 11ᵉ : ce scénario
// n'a de sens qu'avec plusieurs IP d'injection ou une limite relevée sur beta (voir README).
import { sleep } from 'k6';
import { register, uniqueEmail, openDashboard } from './common.js';

export const options = {
  scenarios: {
    signups: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.SIGNUPS_PER_MIN || 30),
      timeUnit: '1m',
      duration: __ENV.DURATION || '10m',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    'http_req_failed{name:POST /auth/register}': ['rate<0.01'],
    'http_req_duration{name:POST /auth/register}': ['p(95)<1500'],
  },
};

export default function () {
  const token = register(uniqueEmail('wave'));
  if (!token) return;
  openDashboard(token); // un nouvel inscrit ouvre aussitôt son tableau de bord
  sleep(1);
}
