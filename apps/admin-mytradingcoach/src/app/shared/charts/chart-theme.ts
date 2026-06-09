import Chart from 'chart.js/auto';
import type { ScriptableContext } from 'chart.js';

/**
 * Thème graphes admin — source de vérité : admin-mytradingcoach.html (objet `C`).
 * Toutes les couleurs sont calées sur les tokens du design system.
 */
export const CHART_COLORS = {
  teal: '#00d4aa',
  blue: '#4a9eff',
  amber: '#f5a623',
  green: '#34d399',
  red: '#ff5563',
  purple: '#a78bfa',
  text3: '#4a5568',
} as const;

export type ChartTone = 'teal' | 'blue' | 'amber' | 'red';

/** Couleur du « reste » des anneaux (fond near-black). */
export const RING_TRACK = '#171a1d';

export const CHART_GRID = 'rgba(255,255,255,0.05)';
/** Axe avec grille discrète (réutilisé par les line/bar). */
export const gridAxis = { color: CHART_GRID } as const;
/** Désactive la légende native. */
export const noLegend = { legend: { display: false } } as const;

let themed = false;

/** Applique les defaults Chart.js (police Geist Mono, couleur text3). Idempotent. */
export function applyChartTheme(): void {
  if (themed) return;
  Chart.defaults.font.family = "'Geist Mono', monospace";
  Chart.defaults.font.size = 10;
  Chart.defaults.color = CHART_COLORS.text3;
  themed = true;
}

/** Dégradé vertical hex → transparent (aires de courbes). */
export function fade(ctx: ScriptableContext<'line'>, hex: string): CanvasGradient {
  const c = ctx.chart.ctx;
  const g = c.createLinearGradient(0, 0, 0, 240);
  g.addColorStop(0, hex + '55');
  g.addColorStop(1, hex + '00');
  return g;
}

export { Chart };