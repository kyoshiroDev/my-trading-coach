/** Débrief hebdomadaire : formes JSON de /debrief (front + API). Dates en ISO. */

/** Point fort ou point faible, avec son badge. */
export interface DebriefBadgeItem {
  badge: string;
  text: string;
}

/** Règle vérifiable automatiquement pendant la semaine suivante (ex. « max 3 trades / jour »). */
export interface ObjectiveCheck {
  type: string;
  params?: Record<string, unknown>;
}

export interface DebriefObjective {
  title: string;
  reason: string;
  note?: string;
  check?: ObjectiveCheck | null;
}

/** Analyse d'un compte de trading : stats et règles calculées par l'API, texte généré par l'IA. */
export interface DebriefAccountSection {
  accountId: string;
  name: string;
  type: string;
  status: string;
  stats: { totalTrades: number; winRate: number; totalPnl: number };
  rules: {
    startingBalance: number | null;
    profitTarget: number | null;
    maxDrawdown: number | null;
    drawdownType: string | null;
  } | null;
  summary: string;
  strengths: DebriefBadgeItem[];
  weaknesses: DebriefBadgeItem[];
  objectives: DebriefObjective[];
  propNote: string | null;
}

/**
 * Contenu du débrief. Deux formats coexistent en base :
 * - actuel : `overview` + une section par compte (`accounts`) ;
 * - ancien (débriefs générés avant le multi-comptes) : `summary`, `strengths`, `weaknesses` à plat.
 */
export interface DebriefInsights {
  overview?: { summary: string };
  accounts?: DebriefAccountSection[];
  summary?: string;
  strengths?: DebriefBadgeItem[];
  weaknesses?: DebriefBadgeItem[];
  emotionInsight?: string;
  objectives?: DebriefObjective[];
}

/** Trades d'une partie de la semaine (bouclier annonces, #670) : nombre, P&L net, taux de réussite (0-100). */
export interface DebriefNewsBucket {
  count: number;
  pnl: number;
  winRate: number;
}

/**
 * Stat « Tes trades autour des annonces » (#670) : trades entre X min avant et X min après une
 * annonce à fort impact de leurs devises, comparés au reste. Absente des anciens débriefs.
 */
export interface DebriefNewsWindow {
  windowMinutes: number;
  inside: DebriefNewsBucket;
  outside: DebriefNewsBucket;
}

export interface WeeklyDebrief {
  id: string;
  weekNumber: number;
  year: number;
  startDate: string;
  endDate: string;
  aiSummary: string;
  insights: DebriefInsights;
  objectives: DebriefObjective[];
  stats: { winRate: number; totalPnl: number; totalTrades: number; newsWindow?: DebriefNewsWindow };
  generatedAt: string;
}
