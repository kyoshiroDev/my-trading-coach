import { buildUserTradingContext, UserTradingProfile } from '../user-context.builder';

/** Catalogue fermé des checks que l'application sait évaluer automatiquement. */
export const OBJECTIVE_CHECK_TYPES = [
  'max_trades',
  'min_trades',
  'no_revenge',
  'all_stops',
  'min_rr',
  'journal_filled',
  'trade_window',
  'setup_only',
  'max_loss_trades',
] as const;
export type ObjectiveCheckType = (typeof OBJECTIVE_CHECK_TYPES)[number];

export const DEBRIEF_SYSTEM_PROMPT = `Tu es un coach de trading qui génère des debriefs hebdomadaires personnalisés, COMPTE PAR COMPTE.
Le trader peut avoir plusieurs comptes (perso, prop firm en évaluation ou funded). Tu analyses chaque compte séparément (forces, faiblesses, objectifs propres) plus une vue d'ensemble cross-compte.
Réponds TOUJOURS et UNIQUEMENT en JSON valide. Pas de texte avant ou après le JSON.
Langue : français, ton coach bienveillant mais direct.
Conformité AMF : jamais de promesse de gain, jamais un chiffre présenté comme officiel. Pour les comptes prop firm, les règles (marge avant drawdown, pacing de l'objectif) sont des ESTIMATIONS calculées depuis les trades loggés dans l'app, PAS le calcul officiel de la firme (qui tient compte des positions ouvertes, du fuseau, du trailing intraday). Tu le précises explicitement.`;

/** Compte (avec ses règles) transmis à l'IA pour l'analyse dédiée. */
export interface DebriefAccountInput {
  accountId: string;
  name: string;
  type: string; // EVALUATION | FUNDED | PERSONAL | DEMO
  startingBalance: number | null;
  profitTarget: number | null;
  maxDrawdown: number | null;
  drawdownType: string | null;
  tradesCount: number;
}

export const buildDebriefPrompt = (data: {
  trades: unknown[];
  stats: unknown;
  previousObjectives: unknown[];
  weekNumber: number;
  year: number;
  userProfile?: UserTradingProfile;
  recentSessions?: unknown[];
  accounts?: DebriefAccountInput[];
  tradesByAccount?: Record<string, unknown[]>;
}) => {
  const accounts = data.accounts ?? [];
  const tradesByAccount = data.tradesByAccount ?? {};

  const accountsBlock = accounts.length
    ? accounts
        .map((a) => {
          const rules = a.maxDrawdown != null || a.profitTarget != null
            ? ` : départ ${a.startingBalance ?? '?'}$, objectif ${a.profitTarget ?? 'aucun'}$, drawdown max ${a.maxDrawdown ?? 'aucun'}$ (${a.drawdownType ?? 'STATIC'})`
            : '';
          return `- [${a.accountId}] "${a.name}" (${a.type})${rules}. ${a.tradesCount} trade(s) cette semaine.`;
        })
        .join('\n')
    : '(aucun compte enregistré, analyse le compte « unassigned » uniquement)';

  return `
Semaine ${data.weekNumber} de ${data.year} : ${data.trades.length} trades, ${accounts.length} compte(s).
${data.userProfile ? buildUserTradingContext(data.userProfile) : ''}
Stats globales de la semaine :
${JSON.stringify(data.stats, null, 2)}

COMPTES ET RÈGLES :
${accountsBlock}

TRADES GROUPÉS PAR COMPTE (clé = accountId, ou "unassigned" pour les trades sans compte) :
${JSON.stringify(tradesByAccount, null, 2)}

Objectifs fixés la semaine précédente :
${JSON.stringify(data.previousObjectives, null, 2)}
${data.recentSessions?.length ? `
Dernières sessions (humeur, P&L, réflexions) :
${JSON.stringify(data.recentSessions.map((s: unknown) => {
  const session = s as {
    startedAt?: string; moodStart?: string; moodEnd?: string;
    totalPnl?: number; totalTrades?: number; winRate?: number;
    reflectionQuestion?: string; reflectionNote?: string;
  };
  return {
    date: session.startedAt,
    moodStart: session.moodStart,
    moodEnd: session.moodEnd,
    pnl: session.totalPnl,
    trades: session.totalTrades,
    winRate: session.winRate,
    question: session.reflectionQuestion,
    reflection: session.reflectionNote,
  };
}), null, 2)}` : ''}

RÈGLES D'ANALYSE PAR COMPTE :
- Une entrée "accounts" par compte ayant des trades cette semaine OU des règles prop firm (même sans trade : explique quoi faire).
- Reprends EXACTEMENT l'accountId fourni. Si des trades sont sous "unassigned", crée une entrée accountId="unassigned".
- "summary" : 1-2 phrases sur ce compte précis.
- "propNote" (comptes prop firm EVALUATION/FUNDED avec règles UNIQUEMENT, sinon null) : comportemental, intègre la MARGE estimée avant drawdown et le PACING de l'objectif, et termine par « (estimation depuis tes trades loggés, pas le calcul officiel de la firme) ». Jamais de chiffre officiel ni de promesse de gain.

RÈGLES OBJECTIFS GLOBAUX (IMPÉRATIF) :
- Le champ racine "objectives" contient 3 à 4 objectifs GLOBAUX (cross-compte), TOUS vérifiables automatiquement.
- Chaque objectif DOIT utiliser EXACTEMENT un "check" du catalogue suivant, avec ses params :
  • max_trades {limit:int}  • min_trades {min:int}  • no_revenge {}  • all_stops {}
  • min_rr {value:number}   • journal_filled {minChars:int}  • trade_window {start:"HH:MM", end:"HH:MM"}
  • setup_only {setups:[...]}  • max_loss_trades {limit:int}
- INTERDIT : tout objectif non mesurable (ex. "définir un drawdown", "partager avec un mentor"). Si tu ne peux pas le rattacher à un check, ne le propose pas.
- Les "objectives" PAR COMPTE (dans accounts[]) sont du conseil libre (title + reason), sans check.

Génère le débrief au format JSON suivant (UNIQUEMENT le JSON, rien d'autre) :
{
  "overview": { "summary": "string (2-3 phrases, bilan cross-compte)" },
  "accounts": [
    {
      "accountId": "string (l'id fourni, ou 'unassigned')",
      "summary": "string (1-2 phrases sur ce compte)",
      "strengths": [{ "badge": "Force" | "Très bien", "text": "string" }],
      "weaknesses": [{ "badge": "Critique" | "Attention", "text": "string" }],
      "objectives": [{ "title": "string", "reason": "string" }],
      "propNote": "string ou null (comptes prop firm uniquement, avec mention estimation)"
    }
  ],
  "objectives": [
    {
      "title": "string (formulation courte et actionnable)",
      "reason": "string (pourquoi cet objectif vu la semaine)",
      "check": { "type": "max_trades|min_trades|no_revenge|all_stops|min_rr|journal_filled|trade_window|setup_only|max_loss_trades", "params": { } }
    }
  ]
}`;
};
