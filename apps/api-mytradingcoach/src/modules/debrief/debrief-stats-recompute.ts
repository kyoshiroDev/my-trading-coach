import type { Prisma, PrismaClient } from '@prisma/client';
import { computeSummary } from '../analytics/analytics-summary';
import { debriefStats } from './debrief-stats';

/**
 * Recalcul des stats des débriefs hebdo déjà enregistrés (#943, suite de #934) : jusqu'au correctif
 * de #934, `WeeklyDebrief.stats` était calculé sur TOUT l'historique du trader au lieu de sa semaine.
 *
 * Fonctions PURES (sans Nest) appelées par `scripts/recompute-debrief-stats.ts`, lancé par Greg :
 * - même calcul que la génération (`computeSummary` + `debriefStats`), bornes = `startDate` / `endDate`
 *   enregistrées dans le débrief (celles de `getWeekInfo` à la génération) ;
 * - seul `stats` est réécrit : le texte de l'IA (résumé, insights, objectifs) ne bouge pas, aucun appel IA ;
 * - comptes démo exclus ;
 * - simulation par défaut ; en écriture, chaque ligne est sauvegardée AVANT d'être modifiée.
 * Les comptes échoués ou archivés sont exclus selon leur statut ACTUEL (comme `getSummary`), pas celui
 * du jour de la génération.
 */

export type RecomputeClient = Pick<PrismaClient, '$queryRaw' | 'weeklyDebrief'>;

/** Ligne de sauvegarde : de quoi remettre `stats` tel qu'il était (`restoreDebriefStats`). */
export interface DebriefStatsBackupRow {
  id: string;
  stats: Prisma.JsonValue;
}

/** Bilan sans identifiant : aucun id de débrief ni d'utilisateur ne sort du script. */
export interface RecomputeReport {
  lus: number;
  modifies: number;
  inchanges: number;
  /** Nombre de débriefs modifiés par champ de `stats` (ex. `totalTrades: 12`). */
  champs: Record<string, number>;
}

/** JSON aux clés triées, pour comparer deux `stats` sans dépendre de l'ordre des clés. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** Champs de `stats` dont la valeur diffère (clés présentes d'un seul côté comprises). */
export function changedStatsFields(before: unknown, after: Record<string, unknown>): string[] {
  const old = before && typeof before === 'object' && !Array.isArray(before) ? (before as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(old), ...Object.keys(after)])].sort();
  return keys.filter((k) => JSON.stringify(stable(old[k])) !== JSON.stringify(stable(after[k])));
}

export async function recomputeDebriefStats(
  prisma: RecomputeClient,
  opts: {
    apply: boolean;
    backup?: (row: DebriefStatsBackupRow) => void;
    batchSize?: number;
    /** Un seul trader (essai sur un compte avant le passage complet). */
    userId?: string;
  },
): Promise<RecomputeReport> {
  if (opts.apply && !opts.backup) throw new Error('Écriture sans sauvegarde refusée');
  const report: RecomputeReport = { lus: 0, modifies: 0, inchanges: 0, champs: {} };
  const take = opts.batchSize ?? 200;
  let cursor: string | null = null;

  for (;;) {
    const batch: { id: string; userId: string; startDate: Date; endDate: Date; stats: Prisma.JsonValue }[] =
      await prisma.weeklyDebrief.findMany({
        where: { user: { isDemo: false }, ...(opts.userId ? { userId: opts.userId } : {}) },
        select: { id: true, userId: true, startDate: true, endDate: true, stats: true },
        orderBy: { id: 'asc' },
        take,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
    if (batch.length === 0) break;

    for (const d of batch) {
      report.lus++;
      const next = debriefStats(await computeSummary(prisma, { userId: d.userId, from: d.startDate, to: d.endDate }));
      const fields = changedStatsFields(d.stats, next);
      if (fields.length === 0) {
        report.inchanges++;
        continue;
      }
      report.modifies++;
      for (const f of fields) report.champs[f] = (report.champs[f] ?? 0) + 1;
      if (!opts.apply) continue;
      opts.backup!({ id: d.id, stats: d.stats });
      await prisma.weeklyDebrief.update({ where: { id: d.id }, data: { stats: next as Prisma.InputJsonValue } });
    }
    cursor = batch[batch.length - 1].id;
    if (batch.length < take) break;
  }
  return report;
}

/** Remet `stats` depuis une sauvegarde (retour arrière). Débrief supprimé depuis : compté, ignoré. */
export async function restoreDebriefStats(
  prisma: Pick<PrismaClient, 'weeklyDebrief'>,
  rows: readonly DebriefStatsBackupRow[],
  apply: boolean,
): Promise<{ lignes: number; restaures: number; introuvables: number }> {
  const bilan = { lignes: rows.length, restaures: 0, introuvables: 0 };
  for (const r of rows) {
    if (!apply) {
      const exists = await prisma.weeklyDebrief.findUnique({ where: { id: r.id }, select: { id: true } });
      if (exists) bilan.restaures++;
      else bilan.introuvables++;
      continue;
    }
    const { count } = await prisma.weeklyDebrief.updateMany({
      where: { id: r.id },
      data: { stats: (r.stats ?? {}) as Prisma.InputJsonValue },
    });
    if (count > 0) bilan.restaures++;
    else bilan.introuvables++;
  }
  return bilan;
}
