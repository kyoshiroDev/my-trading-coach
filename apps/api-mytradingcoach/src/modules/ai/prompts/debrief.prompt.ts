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

export const DEBRIEF_SYSTEM_PROMPT = `Tu es un coach de trading qui génère des debriefs hebdomadaires personnalisés.
Tu analyses la semaine passée du trader et génères un rapport structuré avec forces, faiblesses, insights émotionnels et objectifs pour la semaine suivante.
Réponds TOUJOURS et UNIQUEMENT en JSON valide. Pas de texte avant ou après le JSON.
Langue : français, ton coach bienveillant mais direct.`;

export const buildDebriefPrompt = (data: {
  trades: unknown[];
  stats: unknown;
  previousObjectives: unknown[];
  weekNumber: number;
  year: number;
  userProfile?: UserTradingProfile;
  recentSessions?: unknown[];
}) => `
Semaine ${data.weekNumber} de ${data.year} — ${data.trades.length} trades enregistrés.
${data.userProfile ? buildUserTradingContext(data.userProfile) : ''}
Stats de la semaine :
${JSON.stringify(data.stats, null, 2)}

Trades de la semaine :
${JSON.stringify(data.trades, null, 2)}

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

RÈGLES OBJECTIFS (IMPÉRATIF) :
- Génère 3 à 4 objectifs, TOUS vérifiables automatiquement par l'application.
- Chaque objectif DOIT utiliser EXACTEMENT un "check" du catalogue suivant, avec ses params :
  • max_trades {limit:int}  • min_trades {min:int}  • no_revenge {}  • all_stops {}
  • min_rr {value:number}   • journal_filled {minChars:int}  • trade_window {start:"HH:MM", end:"HH:MM"}
  • setup_only {setups:[...]}  • max_loss_trades {limit:int}
- INTERDIT : tout objectif non mesurable par les données de trading (ex. "définir un drawdown", "partager avec un mentor", "lire un livre"). Si tu ne peux pas le rattacher à un check, ne le propose pas.
- "title" reformule le check en langage trader. Cohérence title ↔ check obligatoire.

Génère le débrief au format JSON suivant (UNIQUEMENT le JSON, rien d'autre) :
{
  "summary": "string (2-3 phrases, bilan de la semaine)",
  "strengths": [{ "badge": "Force" | "Très bien", "text": "string" }],
  "weaknesses": [{ "badge": "Critique" | "Attention", "text": "string" }],
  "emotionInsight": "string (corrélation émotion → performance cette semaine)",
  "objectives": [
    {
      "title": "string (formulation courte et actionnable)",
      "reason": "string (pourquoi cet objectif vu la semaine)",
      "check": { "type": "max_trades|min_trades|no_revenge|all_stops|min_rr|journal_filled|trade_window|setup_only|max_loss_trades", "params": { } }
    }
  ]
}`;
