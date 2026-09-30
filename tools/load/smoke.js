// Fumée : 1 utilisateur, 1 parcours complet. À lancer avant tout autre scénario.
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, register, uniqueEmail, openDashboard, openJournal, sessionPoll } from './common.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ['rate==1'] },
};

export default function () {
  const stats = http.get(`${BASE_URL}/public/stats`, { tags: { name: 'GET /public/stats' } });
  check(stats, { 'public/stats 200': (r) => r.status === 200 });

  const token = register(uniqueEmail('smoke'));
  if (!token) return;
  openDashboard(token);
  openJournal(token);
  sessionPoll(token);
}
