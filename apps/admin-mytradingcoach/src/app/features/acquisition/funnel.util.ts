import type { AdminFunnelData } from '@mtc/shared';

export interface FunnelRow {
  label: string;
  hint: string;
  value: number;
  /** Part de l'étape précédente (%), null pour la 1re étape ou un précédent à 0. */
  rate: number | null;
  /** Largeur de barre (%) relative à la 1re étape. */
  width: number;
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/**
 * Étapes de la visite au paiement. Visites et inscrits viennent de l'acquisition ; les étapes
 * Premium sont des users distincts (hors démo et admin) sur la même période.
 */
export function funnelRows(f: AdminFunnelData | null): FunnelRow[] {
  if (!f) return [];
  const step = (k: AdminFunnelData['steps'][number]['key']) => f.steps.find((s) => s.key === k)?.users ?? 0;
  const raw: Omit<FunnelRow, 'rate' | 'width'>[] = [
    { label: 'Visites landing', hint: 'sans cookie', value: f.landingVisits },
    { label: 'Inscrits', hint: 'hors démo et admin', value: f.signups },
    { label: 'Premium vu', hint: 'cadenas ou teaser affiché', value: step('premium_seen') },
    { label: 'Offres ouvertes', hint: 'modale des offres', value: step('plan_modal_open') },
    { label: 'Clic essai', hint: 'départ vers Stripe', value: step('trial_click') },
    { label: 'Retour Stripe réussi', hint: 'essai ou abonnement créé', value: step('checkout_success') },
  ];
  const top = Math.max(1, raw[0].value);
  return raw.map((r, i) => ({
    ...r,
    rate: i === 0 ? null : pct(r.value, raw[i - 1].value),
    width: Math.round((r.value / top) * 100),
  }));
}

export interface PlaceRow {
  place: string;
  seen: number;
  opened: number;
  clicked: number;
}

/** Par écran : où le Premium est vu, où les offres s'ouvrent, où l'on clique. Tri par « vu ». */
export function placeRows(f: AdminFunnelData | null): PlaceRow[] {
  if (!f) return [];
  const rows = new Map<string, PlaceRow>();
  for (const r of f.byPlace) {
    const row = rows.get(r.place) ?? { place: r.place, seen: 0, opened: 0, clicked: 0 };
    if (r.event === 'premium_seen') row.seen = r.users;
    if (r.event === 'plan_modal_open') row.opened = r.users;
    if (r.event === 'trial_click') row.clicked = r.users;
    rows.set(r.place, row);
  }
  return [...rows.values()].sort((a, b) => b.seen - a.seen || b.opened - a.opened || b.clicked - a.clicked);
}

const PLACE_LABELS: Record<string, string> = {
  dashboard: 'Tableau de bord',
  session: 'Session du jour',
  journal: 'Journal',
  sessions: 'Historique des sessions',
  accounts: 'Mes comptes',
  analytics: 'Statistiques',
  'ai-insights': 'Insights IA',
  debrief: 'Débrief hebdo',
  scoring: 'Score trader',
  'eco-calendar': 'Calendrier éco',
  profil: 'Profil',
  parametres: 'Profil (paramètres)',
};

export function placeLabel(place: string): string {
  return PLACE_LABELS[place] ?? (place || '(sans écran)');
}
