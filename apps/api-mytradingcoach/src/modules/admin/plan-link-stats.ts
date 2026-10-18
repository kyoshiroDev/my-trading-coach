import type { AdminPlanLinkStats } from '@mtc/shared';

/** Compte connecté tel que lu pour la mesure : seulement ce qui sert au calcul. */
export interface PlanLinkRow {
  propFirmPlanId: string | null;
  planLinkChoice: 'LATER' | 'PERSONAL' | 'UNLISTED' | null;
}

/** Réponse « Ma firm n'est pas dans la liste ». */
export interface UnlistedRow {
  unlistedFirm: string | null;
  updatedAt: Date;
}

/**
 * Taux de liaison et firms à ajouter (#612), calcul pur. Les noms saisis sont regroupés sans
 * casse ni espaces superflus (« ftmo » = « FTMO ») ; le libellé gardé est le plus récent.
 */
export function planLinkStats(connected: PlanLinkRow[], unlisted: UnlistedRow[]): AdminPlanLinkStats {
  const unlinked = { later: 0, personal: 0, unlisted: 0, none: 0 };
  let linked = 0;
  for (const a of connected) {
    if (a.propFirmPlanId) linked++;
    else if (a.planLinkChoice === 'LATER') unlinked.later++;
    else if (a.planLinkChoice === 'PERSONAL') unlinked.personal++;
    else if (a.planLinkChoice === 'UNLISTED') unlinked.unlisted++;
    else unlinked.none++;
  }

  const firms = new Map<string, { name: string; count: number; lastAt: Date }>();
  for (const u of unlisted) {
    const name = u.unlistedFirm?.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = firms.get(key);
    if (!cur) firms.set(key, { name, count: 1, lastAt: u.updatedAt });
    else {
      cur.count++;
      if (u.updatedAt > cur.lastAt) Object.assign(cur, { name, lastAt: u.updatedAt });
    }
  }

  return {
    connected: connected.length,
    linked,
    rate: connected.length ? Math.round((linked / connected.length) * 100) : null,
    unlinked,
    unlistedFirms: [...firms.values()]
      .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime())
      .map((f) => ({ name: f.name, count: f.count, lastAt: f.lastAt.toISOString() })),
  };
}
