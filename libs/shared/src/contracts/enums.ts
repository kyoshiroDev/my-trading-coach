/**
 * Enums métier partagés front + back, copie EXACTE des enums de `prisma/schema.prisma`.
 *
 * Pourquoi une copie : le front ne peut pas importer `@prisma/client`. Un test de l'API
 * (`src/common/contracts-sync.spec.ts`) compare chaque enum à Prisma et échoue au moindre écart :
 * après une modification du schéma, le mettre à jour ici.
 *
 * Usage : `EmotionState.FOCUSED` pour une valeur, `EmotionState` (le type) pour une annotation.
 */

export const TradeSide = { LONG: 'LONG', SHORT: 'SHORT' } as const;
export type TradeSide = (typeof TradeSide)[keyof typeof TradeSide];

export const TradeSource = {
  MANUAL: 'MANUAL',
  CSV_IMPORT: 'CSV_IMPORT',
  BROKER_SYNC: 'BROKER_SYNC',
  BROKER_HISTORY: 'BROKER_HISTORY',
} as const;
export type TradeSource = (typeof TradeSource)[keyof typeof TradeSource];

export const EmotionState = {
  CONFIDENT: 'CONFIDENT',
  STRESSED: 'STRESSED',
  REVENGE: 'REVENGE',
  FEAR: 'FEAR',
  FOCUSED: 'FOCUSED',
  NEUTRAL: 'NEUTRAL',
} as const;
export type EmotionState = (typeof EmotionState)[keyof typeof EmotionState];

export const MoodState = {
  CONFIDENT: 'CONFIDENT',
  FOCUSED: 'FOCUSED',
  NEUTRAL: 'NEUTRAL',
  TIRED: 'TIRED',
  STRESSED: 'STRESSED',
} as const;
export type MoodState = (typeof MoodState)[keyof typeof MoodState];

export const ExecutionGrade = { EXCELLENT: 'EXCELLENT', BON: 'BON', MOYEN: 'MOYEN', MAUVAIS: 'MAUVAIS' } as const;
export type ExecutionGrade = (typeof ExecutionGrade)[keyof typeof ExecutionGrade];

export const ExecutionMethod = { STOP_BASED: 'STOP_BASED', BEHAVIORAL: 'BEHAVIORAL' } as const;
export type ExecutionMethod = (typeof ExecutionMethod)[keyof typeof ExecutionMethod];

export const TradingSession = { LONDON: 'LONDON', NEW_YORK: 'NEW_YORK', ASIAN: 'ASIAN' } as const;
export type TradingSession = (typeof TradingSession)[keyof typeof TradingSession];

export const SessionStatus = { ACTIVE: 'ACTIVE', CLOSED: 'CLOSED' } as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const AccountType = { EVALUATION: 'EVALUATION', FUNDED: 'FUNDED', PERSONAL: 'PERSONAL', DEMO: 'DEMO' } as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountStatus = { ACTIVE: 'ACTIVE', PASSED: 'PASSED', FAILED: 'FAILED', ARCHIVED: 'ARCHIVED' } as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const DrawdownType = { STATIC: 'STATIC', TRAILING: 'TRAILING' } as const;
export type DrawdownType = (typeof DrawdownType)[keyof typeof DrawdownType];

export const Role = { ADMIN: 'ADMIN', USER: 'USER', BETA_TESTER: 'BETA_TESTER', AMBASSADOR: 'AMBASSADOR' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Plan = { FREE: 'FREE', PREMIUM: 'PREMIUM' } as const;
export type Plan = (typeof Plan)[keyof typeof Plan];

export const BrokerProvider = { TRADOVATE: 'TRADOVATE' } as const;
export type BrokerProvider = (typeof BrokerProvider)[keyof typeof BrokerProvider];

export const BrokerConnectionStatus = { CONNECTED: 'CONNECTED', NEEDS_RECONNECT: 'NEEDS_RECONNECT' } as const;
export type BrokerConnectionStatus = (typeof BrokerConnectionStatus)[keyof typeof BrokerConnectionStatus];

/** Tous les enums ci-dessus, par nom Prisma : utilisé par le test de synchronisation. */
export const CONTRACT_ENUMS = {
  TradeSide,
  TradeSource,
  EmotionState,
  MoodState,
  ExecutionGrade,
  ExecutionMethod,
  TradingSession,
  SessionStatus,
  AccountType,
  AccountStatus,
  DrawdownType,
  Role,
  Plan,
  BrokerProvider,
  BrokerConnectionStatus,
} as const;
