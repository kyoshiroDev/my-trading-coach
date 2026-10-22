import { formatMoney } from '@mtc/shared';
import { FRENCH_RULE, NO_EM_DASH_RULE } from '../../ai/prompts/style.prompt';
import type { IncidentKind, IncidentReport } from './incident-report';

/** Plafond de l'analyse d'un incident : quelques phrases, jamais plus (#669). */
export const INCIDENT_AI_MAX_TOKENS = 400;

const KIND_LABEL: Record<IncidentKind, string> = {
  drawdown: 'plancher de drawdown estimé franchi',
  daily_loss: 'perte du jour estimée atteinte',
  manual: 'compte marqué comme échoué par le trader',
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

export const INCIDENT_AI_SYSTEM = `Tu décris la séance où un trader a franchi une limite de sa prop firm, d'après des faits déjà calculés par MyTradingCoach.
Règles :
- Commence par « D'après tes trades enregistrés ».
- Décris ce qui s'est passé, dans l'ordre : phases de la séance, taille, alertes, moment où la limite estimée a été franchie.
- N'utilise QUE les chiffres fournis, n'en calcule aucun autre. Les marges et limites sont des estimations MyTradingCoach, jamais le calcul officiel de la firm.
- Aucun conseil d'achat ou de vente, aucune recommandation de position, aucune prédiction, aucune promesse de résultat. Pas d'impératif.
- Ne juge pas le trader. Pas de « tu aurais dû ».
- 2 paragraphes courts, 90 mots au total au plus, sans titre, sans liste, sans markdown.
${NO_EM_DASH_RULE}
${FRENCH_RULE}`;

/** Message utilisateur : uniquement les faits de l'autopsie, déjà calculés. */
export function buildIncidentPrompt(kind: IncidentKind, currency: string, report: IncidentReport): string {
  const money = (v: number) => formatMoney(v, currency, { decimals: 0 });
  const lines = report.timeline.map((e) =>
    e.type === 'trade'
      ? `${time(e.at)} ${e.side} ${e.asset}${e.quantity != null ? ` x${e.quantity}` : ''} : ${money(e.net)}`
        + (e.distanceAfter != null ? `, marge estimée ensuite ${money(e.distanceAfter)}` : '')
        + (e.afterAlert ? ' (après une alerte)' : '')
      : `${time(e.at)} alerte MyTradingCoach : ${e.label}`,
  );
  return [
    `Incident : ${KIND_LABEL[kind]}.`,
    `Séance : ${report.kpis.trades} trades, ${money(report.kpis.net)} net.`,
    report.kpis.startDistance != null ? `Marge estimée avant le premier trade : ${money(report.kpis.startDistance)}.` : '',
    '',
    'Chronologie (heure de sortie, l\'heure d\'entrée n\'est pas connue) :',
    ...lines,
    '',
    'Constats déjà affichés au trader :',
    ...report.findings.map((f) => `- ${f}`),
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
}
