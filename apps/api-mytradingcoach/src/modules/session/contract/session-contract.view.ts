import type { Prisma } from '@prisma/client';
import { SESSION_CONTRACT_RULES, assetRoot, type SessionContract, type SessionContractEdit, type SessionContractRule, type SessionContractRules, type SessionContractValue } from '@mtc/shared';
import type { SessionContractDto } from '../dto/session-contract.dto';

/** Contrat de session (#667) : conversions et fusion, fonctions PURES (partagées par la séance et le moteur). */

export type Row = Prisma.SessionContractGetPayload<object>;

export const EMPTY: SessionContractRules = { maxDailyLoss: null, maxConsecutiveLosses: null, maxTrades: null, newsMinutes: null, allowedAssets: [] };

/** Actifs : racine en majuscules, sans doublon, ordre gardé. */
export function normalizeAssets(assets: readonly string[]): string[] {
  return [...new Set(assets.map(assetRoot).filter(Boolean))];
}

export const rulesOf = (row: Pick<Row, SessionContractRule>): SessionContractRules => ({
  maxDailyLoss: row.maxDailyLoss,
  maxConsecutiveLosses: row.maxConsecutiveLosses,
  maxTrades: row.maxTrades,
  newsMinutes: row.newsMinutes,
  allowedAssets: row.allowedAssets,
});

const same = (a: SessionContractValue, b: SessionContractValue) => JSON.stringify(a) === JSON.stringify(b);

/** Règles demandées appliquées sur les règles existantes : champ absent = inchangé. */
export function mergeRules(base: SessionContractRules, dto: SessionContractDto): SessionContractRules {
  const next = { ...base };
  if (dto.maxDailyLoss !== undefined) next.maxDailyLoss = dto.maxDailyLoss;
  if (dto.maxConsecutiveLosses !== undefined) next.maxConsecutiveLosses = dto.maxConsecutiveLosses;
  if (dto.maxTrades !== undefined) next.maxTrades = dto.maxTrades;
  if (dto.newsMinutes !== undefined) next.newsMinutes = dto.newsMinutes;
  if (dto.allowedAssets !== undefined) next.allowedAssets = normalizeAssets(dto.allowedAssets);
  return next;
}

/** Trace des champs changés, à l'instant `at`. */
export function editsBetween(from: SessionContractRules, to: SessionContractRules, at: Date): SessionContractEdit[] {
  return SESSION_CONTRACT_RULES.filter((f) => !same(from[f], to[f])).map((field) => ({ at: at.toISOString(), field, from: from[field], to: to[field] }));
}

export const toView = (row: Row): SessionContract => ({
  ...rulesOf(row),
  edits: (row.edits as unknown as SessionContractEdit[]) ?? [],
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

