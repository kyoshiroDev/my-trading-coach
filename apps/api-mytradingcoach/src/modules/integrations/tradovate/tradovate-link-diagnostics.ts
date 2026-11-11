/**
 * Diagnostic TEMPORAIRE de la liaison des brackets Tradovate (#916) — fonctions PURES.
 *
 * Constat du 2026-11-11 en prod : « 0 liés, 19 sans jambe liée » alors que chaque entrée avait un
 * stop et un objectif (rapport Orders). Les jambes posées par TradingView / multibracket ne portent
 * donc pas `parentId` = ordre d'entrée. Ce module décrit COMMENT elles sont reliées, sans rien
 * deviner : champs de lien des ordres de sens opposé (même contrat), rattachement par stratégie
 * (`orderStrategyLink`), et noms des champs bruts renvoyés.
 *
 * Ce qui ne sort JAMAIS : prix, montant, `accountId`, nom de compte, id brut d'ordre ou de
 * stratégie, valeur brute d'un champ. Les ordres sont désignés par leur ÉCART d'id à l'entrée
 * (`+1`, `+2`, `-3`) : ça suffit pour comprendre la liaison et rien ne relie le log à un compte.
 *
 * À retirer avec le correctif qui codera la vraie liaison.
 */
import type { TradovateOrderEntity } from './tradovate-orders';

type Raw = Record<string, unknown>;

/** Longueur maximale du log (un seul log par jour et par connexion). */
export const LINK_DIAGNOSTIC_MAX_CHARS = 4000;
/** Ordres candidats décrits par entrée, au plus (les plus proches de l'entrée). */
const MAX_CANDIDATES = 6;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Écart signé à l'entrée : `E` pour l'entrée elle-même, `∅` si absent. */
function rel(v: unknown, entryId: number): string {
  if (!finite(v)) return '∅';
  if (v === entryId) return 'E';
  const d = v - entryId;
  return d > 0 ? `+${d}` : `${d}`;
}

/** Libellé de stratégie réduit à des lettres (jamais une valeur libre longue). */
function cleanLabel(v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) return '∅';
  return v.replace(/[^A-Za-z]/g, '').slice(0, 16) || '?';
}

function keysOf(list: readonly unknown[]): string {
  const first = list.find((x): x is Raw => typeof x === 'object' && x !== null);
  return first ? Object.keys(first).sort().join(',') : '—';
}

export interface LinkDiagnosticInput {
  /** Ids des ordres d'entrée des trades de la synchro (doublons et inconnus ignorés). */
  entryOrderIds: readonly (number | null | undefined)[];
  orders: readonly TradovateOrderEntity[];
  versions: readonly unknown[];
  strategies: readonly unknown[] | null;
  strategyLinks: readonly unknown[] | null;
}

export function describeBracketLinks(input: LinkDiagnosticInput): string {
  const { orders, versions, strategies, strategyLinks } = input;
  const links = (strategyLinks ?? []).filter((l): l is Raw => typeof l === 'object' && l !== null);
  const linkOf = (orderId: number) => links.find((l) => l['orderId'] === orderId);

  const parts: string[] = [
    `ordres ${orders.length}, versions ${versions.length}, ` +
      `stratégies ${strategies ? strategies.length : 'illisible'}, liens ${strategyLinks ? strategyLinks.length : 'illisible'}`,
    `champs order[${keysOf(orders)}]`,
    `champs orderVersion[${keysOf(versions)}]`,
    `champs orderStrategy[${strategies ? keysOf(strategies) : 'illisible'}]`,
    `champs orderStrategyLink[${strategyLinks ? keysOf(strategyLinks) : 'illisible'}]`,
  ];

  const seen = new Set<number>();
  let n = 0;
  for (const id of input.entryOrderIds) {
    if (!finite(id) || seen.has(id)) continue;
    seen.add(id);
    n++;
    const entry = orders.find((o) => o.id === id);
    if (!entry) {
      parts.push(`E${n} absente de /order/list`);
      continue;
    }
    const raw = entry as unknown as Raw;
    const entryLink = linkOf(id);
    const entryStrat = entryLink?.['orderStrategyId'];
    const opposite = entry.action === 'Buy' ? 'Sell' : 'Buy';
    const candidates = orders
      .filter((o) => finite(o.id) && o.id !== id && o.contractId === entry.contractId && o.action === opposite)
      .sort((a, b) => Math.abs((a.id as number) - id) - Math.abs((b.id as number) - id))
      .slice(0, MAX_CANDIDATES)
      .sort((a, b) => (a.id as number) - (b.id as number));

    const legs = candidates.map((o) => {
      const r = o as unknown as Raw;
      const l = linkOf(o.id as number);
      const strat = !l ? '∅' : finite(entryStrat) && l['orderStrategyId'] === entryStrat ? 'même' : 'autre';
      return (
        `${rel(o.id, id)}(${typeof o.ordStatus === 'string' ? o.ordStatus : '?'}` +
        ` parent=${rel(r['parentId'], id)} oco=${rel(r['ocoId'], id)} linked=${rel(r['linkedId'], id)}` +
        ` strat=${strat}${l ? `:${cleanLabel(l['label'])}` : ''})`
      );
    });
    parts.push(
      `E${n} ${entry.action ?? '?'}(parent=${rel(raw['parentId'], id)} oco=${rel(raw['ocoId'], id)} ` +
        `linked=${rel(raw['linkedId'], id)} strat=${entryLink ? `oui:${cleanLabel(entryLink['label'])}` : '∅'}) → ` +
        (legs.length ? legs.join(' ') : 'aucun ordre opposé sur le contrat'),
    );
  }

  const out = parts.join(' | ');
  return out.length > LINK_DIAGNOSTIC_MAX_CHARS ? `${out.slice(0, LINK_DIAGNOSTIC_MAX_CHARS - 1)}…` : out;
}

/** Interrupteur : allumé seulement si `TRADOVATE_LINK_DIAGNOSTIC=true` (absent = éteint). */
export function linkDiagnosticEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env['TRADOVATE_LINK_DIAGNOSTIC']?.trim() === 'true';
}

/** Clé Redis « déjà logué aujourd'hui (UTC) pour cette connexion ». */
export function linkDiagnosticKey(connectionId: string, now: Date): string {
  return `tradovate:linkdiag:${connectionId}:${now.toISOString().slice(0, 10)}`;
}

/** 2 jours : la clé du jour survit à minuit UTC sans s'accumuler. */
export const LINK_DIAGNOSTIC_TTL_S = 172_800;
