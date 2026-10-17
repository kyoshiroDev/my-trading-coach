// Vague d'inscriptions du jour J : 30 inscriptions/min pendant 10 min (audit C1–C4, SCA-B9-02 #487).
// Avec LOAD_TEST_KEY, chaque inscription est un client distinct (`signup-<vu>-<itération>`), comme
// de vrais nouveaux inscrits arrivant chacun de leur IP. Avant le 2026-10-17, l'identifiant était
// celui du VU (`vu-<n>`) : 20 VU × 10 inscriptions/h/client = 200 au plus, puis 429 (artefact du
// premier passage, pas une limite de capacité). Sans la clé, tout est compté sur l'IP de
// l'injecteur et la limite d'inscription (10/h/IP, SCA-B0-04) bloque dès la 11ᵉ.
//
// Critère « 0 e-mail perdu » : chaque inscription réussie met un job dans la file `email`
// (SCA-B5-02) → compter les jobs côté Redis après le test (docs/ops/test-charge-vps-prod.md, §3).
import { sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { register, uniqueEmail, openDashboard } from './common.js';

const signupsOk = new Counter('signups_ok');

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
  const token = register(uniqueEmail('wave'), undefined, `signup-${__VU}-${__ITER}`);
  if (!token) return;
  signupsOk.add(1); // à comparer au nombre de jobs de la file e-mail
  openDashboard(token); // un nouvel inscrit ouvre aussitôt son tableau de bord
  sleep(1);
}
