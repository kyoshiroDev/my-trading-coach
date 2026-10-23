import type { AccountIncidentReport } from '@mtc/shared';

/** Séance de la maquette (`maquettes/mockup-autopsie.html`), heures de Paris (UTC+2 le 14/10/2026). */
const at = (hhmm: string) => `2026-10-14T${String(+hhmm.slice(0, 2) - 2).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`;
const trade = (id: string, hhmm: string, side: string, quantity: number, net: number, distanceAfter: number, afterAlert = false) =>
  ({ type: 'trade' as const, at: at(hhmm), tradeId: id, asset: 'MNQ', side, quantity, net, distanceAfter, afterAlert });

/** Réponse de l'API pour la séance de la maquette (tests de l'autopsie). */
export function mockupReport(over: Partial<AccountIncidentReport> = {}): AccountIncidentReport {
  return {
    id: 'inc', kind: 'drawdown', tradeDate: '2026-10-14', source: 'sync', createdAt: at('11:13'), limit: 2000,
    account: { id: 'acc', label: 'Apex 50K · Éval #1', currency: 'USD', status: 'FAILED' },
    canReactivate: true,
    kpis: { net: -1050, trades: 5, maxQuantity: 4, firstQuantity: 2, startDistance: 1000 },
    series: [
      { at: null, distance: 1000 }, { at: at('09:34'), distance: 1080 }, { at: at('09:58'), distance: 940 },
      { at: at('10:21'), distance: 780 }, { at: at('10:49'), distance: 360 }, { at: at('11:12'), distance: -50 },
    ],
    timeline: [
      trade('t1', '09:34', 'LONG', 2, 80, 1080),
      trade('t2', '09:58', 'SHORT', 2, -140, 940),
      trade('t3', '10:21', 'LONG', 2, -160, 780),
      { type: 'alert', at: at('10:44'), label: "pertes d'affilée", nextTradeMinutes: 5 },
      trade('t4', '10:49', 'LONG', 4, -420, 360, true),
      trade('t5', '11:12', 'SHORT', 4, -410, -50, true),
    ],
    findings: ['Constat 1.', 'Constat 2.', 'Constat 3.'],
    ai: { status: 'locked' },
    estimatedDistance: true,
    disclaimer: "Estimation MyTradingCoach d'après tes trades enregistrés, pas le calcul officiel de ta firm.",
    ...over,
  };
}

/**
 * Limite déjà franchie AVANT la séance (casse un jour précédent, synchro tardive) : un trade
 * gagnant à 21:12 qui laisse la marge estimée sous zéro (revue #712).
 */
export function alreadyCrossedReport(): AccountIncidentReport {
  return mockupReport({
    tradeDate: '2026-08-20', limit: 1000,
    account: { id: 'acc', label: 'Lucid 25K · Flex', currency: 'USD', status: 'ARCHIVED' },
    kpis: { net: 58, trades: 1, maxQuantity: 2, firstQuantity: 2, startDistance: -98 },
    series: [{ at: null, distance: -98 }, { at: '2026-08-20T19:12:00.000Z', distance: -40 }],
    timeline: [{
      type: 'trade', at: '2026-08-20T19:12:00.000Z', tradeId: 'w', asset: 'MES', side: 'SHORT', quantity: 2,
      net: 58, distanceAfter: -40, afterAlert: false,
    }],
  });
}

export { at as parisAt };
