import type { MoodState } from './enums';

/** Session clôturée, telle que renvoyée par GET /session/history. Dates en ISO. */
export interface SessionHistoryItem {
  id: string;
  /** Compte de la séance (1 séance = 1 compte, #457) : montants dans SA devise (#947). */
  accountId?: string | null;
  startedAt: string;
  endedAt?: string;
  moodStart?: MoodState | null;
  moodEnd?: MoodState | null;
  totalPnl?: number | null;
  totalTrades: number;
  winRate?: number | null;
  /** Trades gagnants / perdants de la séance (net des frais, BE et ouverts exclus, computeTradeStats). */
  wins: number;
  losses: number;
  notes?: string | null;
  reflectionNote?: string | null;
  reflectionQuestion?: string | null;
  planNote?: string | null;
  marketContext?: string | null;
  maxDrawdown?: number | null;
  bestTradePnl?: number | null;
  bestTradeAsset?: string | null;
  topAssets: string[];
  /** Résumé IA du récap quotidien du même jour (heure de Paris), s'il existe. */
  aiOneLiner?: string | null;
}

/** Position ouverte chez le broker (synchro Tradovate), avant qu'elle ne devienne un trade. */
export interface LiveOpenPosition {
  asset: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number | null;
  /** Ouverture de la position (ISO), `null` si le broker ne la donne pas. */
  since: string | null;
  /**
   * SL / TP posés chez le broker (ordres actifs lus en direct, #601). `null` = aucun ordre, ou
   * plusieurs candidats sans lien de bracket : jamais une association devinée.
   */
  stopPrice: number | null;
  targetPrice: number | null;
}

/**
 * État broker du compte de la session active, dans GET /session/today/stats (`broker`) :
 * `null` si le compte n'est pas synchronisé par API. Le latent vient du broker (ses cotations),
 * relu à chaque événement de trade ou sur « Actualiser », jamais en boucle : d'où sa date.
 */
export interface LiveBrokerState {
  openPositions: LiveOpenPosition[];
  /** Lecture des positions chez le broker (ISO), `null` si jamais lues. */
  positionsAt: string | null;
  /** P&L latent selon le broker ; `null` = inconnu (jamais un chiffre inventé). */
  openPnl: number | null;
  openPnlAt: string | null;
}

// ── Contrat de session (#667) ─────────────────────────────────────────────────
// Évaluation et bornes : `session-contract.ts` (calculs) ; ici les formes échangées avec l'API.

export type SessionContractRule = 'maxDailyLoss' | 'maxConsecutiveLosses' | 'maxTrades' | 'newsMinutes' | 'allowedAssets';

/** Règles du contrat. null = règle non fixée ; `allowedAssets` vide = tous les actifs. */
export interface SessionContractRules {
  /** Perte max du jour, montant POSITIF dans la devise du compte. */
  maxDailyLoss: number | null;
  maxConsecutiveLosses: number | null;
  maxTrades: number | null;
  /** Minutes avant et après une annonce à fort impact. */
  newsMinutes: number | null;
  /** Racines d'actifs en majuscules (« MNQ », « MES »). */
  allowedAssets: string[];
}

export type SessionContractValue = number | string[] | null;

/** Trace d'une modification pendant la séance. `at` en ISO. */
export interface SessionContractEdit {
  at: string;
  field: SessionContractRule;
  from: SessionContractValue;
  to: SessionContractValue;
}

/** Contrat d'une séance tel que renvoyé par l'API. */
export interface SessionContract extends SessionContractRules {
  edits: SessionContractEdit[];
  createdAt: string;
  updatedAt: string;
}

/** Préremplissage de la pré-session (`GET /session/contract/defaults`). */
export interface SessionContractDefaults {
  /** Compte de la séance à venir ; null = aucun compte encore (créé au démarrage). */
  accountId: string | null;
  rules: SessionContractRules;
  /** D'où viennent les valeurs : dernière séance du compte, profil, ou rien. */
  source: 'last_session' | 'profile' | 'none';
  lastSessionAt: string | null;
  /**
   * Limite de perte du jour de la firm (estimation MyTradingCoach, celle de Mes comptes), null sans règle ou
   * hors Premium (la perte du jour de la firm est Premium, #370).
   */
  firmDailyLossLimit: number | null;
  /** Perte max perso plus large que la limite de la firm. */
  looserThanFirm: boolean;
}

/** `GET /session/contract/config` : l'app sait si le contrat est allumé. */
export interface SessionContractConfig {
  enabled: boolean;
}

export type SessionContractStatus = 'respected' | 'breached' | 'not_applicable';

export interface SessionContractRuleResult {
  rule: SessionContractRule;
  status: SessionContractStatus;
  /** Limite en vigueur au trade fautif, sinon la limite finale. */
  limit: SessionContractValue;
  /** Trade qui franchit la règle (le premier), heure en ISO. */
  breachTradeId: string | null;
  breachAt: string | null;
  /** Trades clôturés APRÈS le trade fautif (celui-ci exclu), P&L net dans la devise du compte. */
  after: { count: number; pnl: number } | null;
  /**
   * Mesure à afficher : trades de la séance, plus longue série de pertes, P&L net réalisé, trades sur un
   * actif autorisé, trades dans la fenêtre d'une annonce.
   */
  measure: number;
}

export interface SessionContractEvaluation {
  rules: SessionContractRuleResult[];
  /** Règles tenues / applicables (« sans objet » exclu). */
  respected: number;
  applicable: number;
}

/** Corps de `POST /session/start` (`contract`) et de `PATCH /session/:id/contract` : champ absent = inchangé. */
export type SessionContractRequest = Partial<SessionContractRules>;

/** Ajouts de `GET /session/today` et `GET /session/history/:id` quand la séance a un contrat. */
export interface SessionWithContract {
  contract?: SessionContract;
  evaluation?: SessionContractEvaluation;
}

