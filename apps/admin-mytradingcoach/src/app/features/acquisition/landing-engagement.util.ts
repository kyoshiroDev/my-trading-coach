import {
  LANDING_ENGAGEMENT_PAGES,
  LANDING_SCROLL_THRESHOLDS,
  LANDING_TIME_THRESHOLDS,
  type AdminLandingEngagementData,
  type AdminLandingEngagementRow,
  type LandingEngagementPage,
} from '@mtc/shared';

/** Colonnes du tableau : vues, puis seuils de défilement, de temps, et sélecteur de règles. */
export const ENGAGEMENT_COLUMNS: readonly { label: string; hint: string }[] = [
  { label: 'Vues', hint: 'pages vues' },
  ...LANDING_SCROLL_THRESHOLDS.map((t) => ({ label: `${t} %`, hint: `défilement ${t} %` })),
  ...LANDING_TIME_THRESHOLDS.map((t) => ({ label: `${t} s`, hint: `${t} s onglet visible` })),
  { label: 'Règles', hint: 'sélecteur de règles utilisé' },
];

const PAGE_LABELS: Record<LandingEngagementPage, string> = { '/': 'Accueil', '/prop-firm': 'Prop firm' };

export interface EngagementCell {
  value: number;
  /** % des vues de la ligne, `null` pour la colonne Vues ou sans vue. */
  rate: number | null;
}

export interface EngagementLine {
  key: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  cells: EngagementCell[];
}

export interface EngagementPageGroup {
  path: LandingEngagementPage;
  label: string;
  total: EngagementCell[];
  lines: EngagementLine[];
}

const values = (r: AdminLandingEngagementRow): number[] => [r.views, ...r.scroll, ...r.time, r.rulesUse];

/** Valeurs → cellules avec le taux par rapport aux vues (1re valeur). */
export function toEngagementCells(vals: number[]): EngagementCell[] {
  const views = vals[0];
  return vals.map((value, i) => ({ value, rate: i > 0 && views > 0 ? Math.round((value / views) * 100) : null }));
}

/**
 * Une section par page mesurée (ordre de `LANDING_ENGAGEMENT_PAGES`), même sans donnée, avec sa
 * ligne Total et ses lignes par source / medium / campagne (ordre de l'API : vues décroissantes).
 */
export function engagementGroups(data: AdminLandingEngagementData | null): EngagementPageGroup[] {
  if (!data) return [];
  return LANDING_ENGAGEMENT_PAGES.map((path) => {
    const rows = data.rows.filter((r) => r.path === path);
    const lines = rows.map((r) => ({
      key: JSON.stringify([r.source, r.medium, r.campaign]),
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      cells: toEngagementCells(values(r)),
    }));
    const sums = ENGAGEMENT_COLUMNS.map((_, i) => rows.reduce((s, r) => s + values(r)[i], 0));
    return { path, label: PAGE_LABELS[path], total: toEngagementCells(sums), lines };
  });
}
