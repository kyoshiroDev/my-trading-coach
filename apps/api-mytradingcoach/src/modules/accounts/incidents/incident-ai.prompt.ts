import { formatMoney } from '@mtc/shared';
import { FRENCH_RULE, NO_EM_DASH_RULE } from '../../ai/prompts/style.prompt';
import { crossingPoint, type IncidentKind, type IncidentReport } from './incident-report';

/** Plafond de l'analyse d'un incident : quelques phrases, jamais plus (#669). */
export const INCIDENT_AI_MAX_TOKENS = 400;

const KIND_LABEL: Record<IncidentKind, string> = {
  drawdown: 'plancher de drawdown estimé franchi',
  daily_loss: 'perte du jour estimée atteinte',
  manual: 'compte marqué comme échoué par le trader',
};

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

export const INCIDENT_AI_SYSTEM = `Tu décris la séance qui a mené à l'échec d'un compte de prop firm, d'après des faits déjà calculés par MyTradingCoach.
Règles :
- Commence par « D'après tes trades enregistrés ».
- Décris ce qui s'est passé, dans l'ordre : phases de la séance, taille, alertes, puis le franchissement de la limite seulement s'il figure dans les faits.
- Ne parle que de la limite nommée dans les faits (plancher de drawdown ou perte du jour), jamais d'une autre. Si les faits indiquent qu'aucune limite n'est relevée, n'écris pas qu'une limite a été franchie. Ne donne une heure de franchissement que si elle est fournie.
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
    crossing(kind, report),
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

/**
 * Ce que l'on sait du franchissement, et rien de plus : sans relevé (échec marqué à la main), le
 * modèle inventait une limite (« limite journalière franchie ») absente de la page.
 */
function crossing(kind: IncidentKind, report: IncidentReport): string {
  if (kind === 'manual') return 'Aucune limite relevée par MyTradingCoach : le trader a marqué le compte comme échoué lui-même.';
  const at = crossingPoint(report.series)?.at;
  if (at) return `Limite estimée franchie à ${time(at)}.`;
  if (report.kpis.startDistance != null && report.kpis.startDistance <= 0) return 'Limite estimée déjà franchie avant le premier trade.';
  return 'Heure du franchissement non connue.';
}
