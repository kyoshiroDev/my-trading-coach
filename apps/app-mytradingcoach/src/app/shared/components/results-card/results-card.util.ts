import type { MoodState } from '@mtc/shared';

/** Formats de la carte : post carré Instagram ou Story. */
export type ResultsCardFormat = 'square' | 'story';

export const RESULTS_CARD_SIZE: Record<ResultsCardFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story:  { width: 1080, height: 1920 },
};

/** Données affichées par la carte, déjà mises en forme (montant dans la devise du compte). */
export interface ResultsCardData {
  pnlLabel: string;
  pnlPositive: boolean;
  winRateLabel: string;
  tradesCount: number;
  moodEmoji: string;
  moodLabel: string;
  /** « Samedi 4 octobre » (carré) ; la Story ajoute l'année. */
  dateLabel: string;
  dateLabelLong: string;
  /** Code de parrainage de l'utilisateur connecté, `null` si indisponible. */
  referralCode: string | null;
}

/**
 * Humeurs de fin de session : mêmes emoji que le sélecteur du débrief, pour que la carte
 * montre ce que l'utilisateur a cliqué (STRESSED n'y est pas proposé mais peut venir de l'API).
 */
export const MOOD_OPTIONS: { value: MoodState; label: string; emoji: string }[] = [
  { value: 'CONFIDENT', label: 'Confiant', emoji: '😎' },
  { value: 'FOCUSED',   label: 'Focalisé', emoji: '🎯' },
  { value: 'NEUTRAL',   label: 'Neutre',   emoji: '😐' },
  { value: 'TIRED',     label: 'Fatigué',  emoji: '😰' },
];
const STRESSED = { label: 'Stressé', emoji: '😰' };

export function moodDisplay(mood: MoodState | null | undefined): { label: string; emoji: string } {
  if (mood === 'STRESSED') return STRESSED;
  return MOOD_OPTIONS.find((m) => m.value === mood) ?? MOOD_OPTIONS[2];
}

const SITE = 'mytradingcoach.app';

/** Lien affiché sur la carte : `mytradingcoach.app/?ref=CODE`, ou le domaine seul sans code. */
export function referralDisplay(code: string | null | undefined): string {
  return code ? `${SITE}/?ref=${encodeURIComponent(code)}` : SITE;
}

/** Lien complet du texte de partage (récupéré par WhatsApp, X… mais jamais cliquable sur Instagram). */
export function referralUrl(code: string | null | undefined): string {
  return `https://${referralDisplay(code)}`;
}

export function shareText(code: string | null | undefined): string {
  return `Mon débrief de session sur MyTradingCoach 📈 ${referralUrl(code)}`;
}

/**
 * Diffusion progressive : bêta-testeurs, admins et ambassadeurs (premiers à publier, lien
 * de parrainage commissionné). À ouvrir à tous après un retour bêta positif explicite.
 */
export const RESULTS_SHARE_ROLES: readonly string[] = ['BETA_TESTER', 'ADMIN', 'AMBASSADOR'];

/** Bouton « Publier mes résultats » : rôle autorisé ET session clôturée (stats du jour connues). */
export function canPublishResults(role: string | null | undefined, sessionStatus: string | null | undefined): boolean {
  return !!role && RESULTS_SHARE_ROLES.includes(role) && sessionStatus === 'CLOSED';
}

export interface DebriefStats { totalPnl: number; winRate: number; tradesCount: number }

/**
 * Chiffres du débrief et de la carte : ceux de la session clôturée (calculés par l'API sur SES
 * trades, net des frais) ; à défaut les stats du jour. Les stats du jour couvrent toute la
 * journée, donc plusieurs sessions : elles gonflaient le P&L de la carte publiée (#457).
 */
export function debriefStats(
  session: { status: string; totalPnl?: number | null; winRate?: number | null; totalTrades: number } | null | undefined,
  todayStats: DebriefStats | null | undefined,
): DebriefStats | null {
  if (session?.status === 'CLOSED' && session.totalPnl != null) {
    return { totalPnl: session.totalPnl, winRate: session.winRate ?? 0, tradesCount: session.totalTrades };
  }
  return todayStats ?? null;
}

/** Rien à partager sans trade ou avec un P&L nul : pas de carte vide. */
export function hasResultsToShare(stats: { tradesCount: number; totalPnl: number } | null | undefined): boolean {
  return !!stats && stats.tradesCount > 0 && stats.totalPnl !== 0;
}

/** `mytradingcoach-debrief-2026-10-04-story.png` (date locale, pas UTC). */
export function resultsFileName(date: Date, format: ResultsCardFormat): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `mytradingcoach-debrief-${day}-${format === 'story' ? 'story' : 'post'}.png`;
}

/** « samedi 4 octobre » → « Samedi 4 octobre » ; `withYear` pour la Story. */
export function frenchDayLabel(date: Date, withYear = false): string {
  const label = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}),
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
