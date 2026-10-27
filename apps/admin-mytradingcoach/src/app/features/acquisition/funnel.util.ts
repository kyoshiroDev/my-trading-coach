import { PREMIUM_SIGNUP_TRIAL_DAYS, type AdminFunnelData, type AdminInstallEvent } from '@mtc/shared';

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

export interface TrialTile {
  label: string;
  value: number;
  sub: string;
  tone: 'teal' | 'blue' | 'purple' | 'amber';
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });

/**
 * Essai Premium de l'inscription (#769, B3) : en cours, terminés sur la période, conversions après
 * essai (part des terminés) et réservations fondateur jamais payées. Hors démo et admin.
 */
export function signupTrialTiles(f: AdminFunnelData | null): TrialTile[] {
  if (!f) return [];
  const t = f.signupTrial;
  const rate = pct(t.converted, t.ended);
  const resa = [
    t.reservationsAwaitingPayment > 0 ? `${t.reservationsAwaitingPayment} paiement(s) en attente` : null,
    t.nextChargeAt ? `prochain prélèvement le ${shortDate(t.nextChargeAt)}` : null,
  ].filter(Boolean);
  return [
    { label: 'Essais en cours', value: t.inProgress, sub: `${PREMIUM_SIGNUP_TRIAL_DAYS} jours offerts, sans abonnement payant`, tone: 'teal' },
    { label: `Essais terminés · ${f.days} j`, value: t.ended, sub: 'fin d’essai sur la période', tone: 'blue' },
    {
      label: 'Conversions après essai', value: t.converted,
      sub: rate === null ? 'aucun essai terminé' : `${rate}\u00a0% des essais terminés, abonnement payant`, tone: 'purple',
    },
    { label: 'Réservations fondateur', value: t.reservations, sub: resa.length ? resa.join(' · ') : 'en attente du premier paiement', tone: 'amber' },
  ];
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

export interface InstallRow {
  place: string;
  label: string;
  /** Users distincts par événement (0 si aucun). */
  counts: Record<AdminInstallEvent, number>;
}

export const INSTALL_COLUMNS: { event: AdminInstallEvent; label: string }[] = [
  { event: 'install_shown', label: 'Parcours affiché' },
  { event: 'install_click', label: 'Clic installer' },
  { event: 'install_done', label: 'Installée' },
  { event: 'install_later', label: 'Plus tard' },
  { event: 'install_never', label: 'Ne plus proposer' },
  { event: 'inapp_seen', label: 'Navigateur intégré' },
  { event: 'push_enabled', label: 'Alertes activées' },
  { event: 'push_denied', label: 'Alertes refusées' },
];

const INSTALL_PLACE_LABELS: Record<string, string> = {
  android: 'Android',
  ios: 'iPhone (Safari)',
  'ios-other': 'iPhone (autre navigateur)',
  desktop: 'Ordinateur',
};
const INSTALL_ORDER = Object.keys(INSTALL_PLACE_LABELS);

/**
 * Installation de l'app par plateforme. Une ligne par plateforme ENREGISTRÉE : `ios-other` n'est
 * jamais ajouté à `ios`, et une plateforme inconnue s'affiche telle quelle (jamais écartée).
 */
export function installRows(f: AdminFunnelData | null): InstallRow[] {
  if (!f) return [];
  const rows = new Map<string, InstallRow>();
  for (const r of f.install) {
    const row = rows.get(r.place) ?? {
      place: r.place,
      label: INSTALL_PLACE_LABELS[r.place] ?? (r.place || '(sans plateforme)'),
      counts: Object.fromEntries(INSTALL_COLUMNS.map((c) => [c.event, 0])) as InstallRow['counts'],
    };
    row.counts[r.event] = r.users;
    rows.set(r.place, row);
  }
  const rank = (p: string) => (INSTALL_ORDER.includes(p) ? INSTALL_ORDER.indexOf(p) : INSTALL_ORDER.length);
  return [...rows.values()].sort((a, b) => rank(a.place) - rank(b.place) || a.place.localeCompare(b.place));
}
