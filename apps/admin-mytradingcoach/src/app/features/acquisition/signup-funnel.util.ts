import type { AdminSignupFunnelData, AdminSignupFunnelError, AdminSignupFunnelRow, SignupFunnelStep } from '@mtc/shared';

/** Filtre « navigateur » de la vue Parcours d'inscription. */
export type BrowserFilter = 'all' | 'inApp' | 'normal';

/** Colonnes du tableau, dans l'ordre du parcours (la visite vient de LandingVisitDaily). */
export const SIGNUP_COLUMNS: readonly { key: 'visits' | SignupFunnelStep; label: string }[] = [
  { key: 'visits', label: 'Visites' },
  { key: 'cta_click', label: 'Clics CTA' },
  { key: 'register_view', label: 'Page inscription' },
  { key: 'register_submit', label: 'Envois' },
  { key: 'register_success', label: 'Inscrits' },
  { key: 'checkout_redirect', label: 'Checkout' },
];

export interface SignupCell {
  value: number;
  /** % de l'étape précédente, `null` si l'étape précédente vaut 0 (ou première colonne). */
  rate: number | null;
}

export interface SignupFunnelLine {
  key: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  cells: SignupCell[];
}

export interface SignupErrorLine {
  source: string | null;
  code: string;
  label: string;
  count: number;
}

const ERROR_LABELS: Record<string, string> = {
  email_taken: 'E-mail déjà utilisé',
  validation: 'Formulaire refusé',
  network: 'Réseau',
  server: 'Erreur serveur',
  other: 'Autre',
};

export const errorLabel = (code: string): string => ERROR_LABELS[code] ?? code;

const keep = (inApp: boolean, filter: BrowserFilter) =>
  filter === 'all' || (filter === 'inApp') === inApp;

const values = (r: Pick<AdminSignupFunnelRow, 'visits' | 'steps'>): number[] =>
  SIGNUP_COLUMNS.map((c) => (c.key === 'visits' ? r.visits : r.steps[c.key]));

/** Valeurs → cellules avec le taux de passage depuis l'étape précédente. */
export function toCells(vals: number[]): SignupCell[] {
  return vals.map((value, i) => {
    const prev = i === 0 ? 0 : vals[i - 1];
    return { value, rate: prev > 0 ? Math.round((value / prev) * 100) : null };
  });
}

/**
 * Lignes du tableau pour un filtre navigateur : « Tous » additionne intégré + normal d'une même
 * source / medium / campagne. Tri : visites puis clics CTA décroissants.
 */
export function signupLines(data: AdminSignupFunnelData | null, filter: BrowserFilter): SignupFunnelLine[] {
  if (!data) return [];
  const merged = new Map<string, { row: AdminSignupFunnelRow; vals: number[] }>();
  for (const r of data.rows) {
    if (!keep(r.inApp, filter)) continue;
    const key = JSON.stringify([r.source, r.medium, r.campaign]);
    const vals = values(r);
    const cur = merged.get(key);
    if (cur) cur.vals = cur.vals.map((v, i) => v + vals[i]);
    else merged.set(key, { row: r, vals });
  }
  return [...merged.entries()]
    .sort(([, a], [, b]) => b.vals[0] - a.vals[0] || b.vals[1] - a.vals[1])
    .map(([key, { row, vals }]) => ({ key, source: row.source, medium: row.medium, campaign: row.campaign, cells: toCells(vals) }));
}

/** Ligne Total (somme des lignes affichées), `null` s'il n'y a rien. */
export function signupTotal(lines: SignupFunnelLine[]): SignupCell[] | null {
  if (!lines.length) return null;
  return toCells(SIGNUP_COLUMNS.map((_, i) => lines.reduce((s, l) => s + l.cells[i].value, 0)));
}

/** Erreurs d'inscription pour un filtre navigateur, fusionnées par source + code, triées. */
export function signupErrors(errors: AdminSignupFunnelError[] | undefined, filter: BrowserFilter): SignupErrorLine[] {
  const merged = new Map<string, SignupErrorLine>();
  for (const e of errors ?? []) {
    if (!keep(e.inApp, filter)) continue;
    const key = JSON.stringify([e.source, e.code]);
    const cur = merged.get(key);
    if (cur) cur.count += e.count;
    else merged.set(key, { source: e.source, code: e.code, label: errorLabel(e.code), count: e.count });
  }
  return [...merged.values()].sort((a, b) => b.count - a.count);
}
