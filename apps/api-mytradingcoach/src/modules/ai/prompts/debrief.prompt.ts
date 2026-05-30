import { buildUserTradingContext, UserTradingProfile } from '../user-context.builder';

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

Génère le débrief au format JSON suivant (UNIQUEMENT le JSON, rien d'autre) :
{
  "summary": "string (2-3 phrases, bilan de la semaine)",
  "strengths": [{ "badge": "Force" | "Très bien", "text": "string" }],
  "weaknesses": [{ "badge": "Critique" | "Attention", "text": "string" }],
  "emotionInsight": "string (corrélation émotion → performance cette semaine)",
  "objectives": [{ "title": "string", "reason": "string" }]
}`;
