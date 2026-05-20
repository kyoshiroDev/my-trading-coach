export interface UserTradingProfile {
  market?: string | null;
  goal?: string | null;
  tradingStyle?: string | null;
  tradingStrategy?: string[];
  tradingSessions?: string[];
  tradesPerDayMin?: number | null;
  tradesPerDayMax?: number | null;
  strategyDescription?: string | null;
}

const STYLE_MAP: Record<string, string> = {
  SCALPING:    'Scalper (trades courts, quelques secondes à quelques minutes)',
  DAY_TRADING: 'Day Trader (positions fermées dans la journée)',
  SWING:       'Swing Trader (positions de quelques jours à semaines)',
  POSITION:    'Trader long terme (positions de plusieurs semaines à mois)',
};

const SESSION_MAP: Record<string, string> = {
  LONDON:   'Londres (8h-12h CET)',
  NEW_YORK: 'New York (14h-20h CET)',
  ASIAN:    'Asie (00h-08h CET)',
};

const MARKET_MAP: Record<string, string> = {
  CRYPTO:  'Crypto (Bitcoin, Ethereum, altcoins)',
  FOREX:   'Forex (paires de devises)',
  ACTIONS: 'Actions, ETF, indices',
  MULTI:   'Multi-marchés',
};

const GOAL_MAP: Record<string, string> = {
  DISCIPLINE:  'améliorer sa discipline et respecter ses règles',
  PERFORMANCE: 'améliorer sa performance et son win rate',
  PSYCHOLOGIE: 'gérer ses émotions et éviter les revenge trades',
};

export function buildUserTradingContext(profile: UserTradingProfile): string {
  const lines: string[] = [];

  if (profile.tradingStyle) {
    lines.push(`Style de trading : ${STYLE_MAP[profile.tradingStyle] ?? profile.tradingStyle}`);
  }
  if (profile.tradingStrategy?.length) {
    lines.push(`Stratégie : ${profile.tradingStrategy.join(', ')}`);
  }
  if (profile.strategyDescription) {
    lines.push(`Description stratégie : ${profile.strategyDescription}`);
  }
  if (profile.tradingSessions?.length) {
    const sessions = profile.tradingSessions.map(s => SESSION_MAP[s] ?? s).join(', ');
    lines.push(`Sessions de trading : ${sessions}`);
  }
  if (profile.tradesPerDayMin != null && profile.tradesPerDayMax != null) {
    lines.push(
      `Fréquence normale : ${profile.tradesPerDayMin}-${profile.tradesPerDayMax} trades par jour` +
      ` — NE PAS considérer cette fréquence comme un problème, c'est sa stratégie normale.`,
    );
  } else if (profile.tradesPerDayMax != null) {
    lines.push(`Fréquence normale : jusqu'à ${profile.tradesPerDayMax} trades par jour.`);
  }
  if (profile.market) {
    lines.push(`Marché principal : ${MARKET_MAP[profile.market] ?? profile.market}`);
  }
  if (profile.goal) {
    lines.push(`Objectif principal : ${GOAL_MAP[profile.goal] ?? profile.goal}`);
  }

  if (!lines.length) return '';
  return `\n--- PROFIL DU TRADER ---\n${lines.join('\n')}\n--- FIN DU PROFIL ---\n`;
}
