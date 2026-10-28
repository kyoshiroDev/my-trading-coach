/**
 * Réparation des P&L tronqués au séparateur de milliers (bug prod du 2026-10-28) : l'ancien
 * `parseTradovatePnl` lisait `"$1,125.00"` comme 1. Touche les imports CSV Tradovate et
 * l'historique (Reporting API) ; la synchro live calcule son P&L à partir des prix, elle est saine.
 * Détection : `src/modules/trades/pnl-milliers.util.ts` (P&L recalculé depuis les prix ≥ 1 000 $
 * ET P&L enregistré égal à sa troncature exacte, futures du référentiel seulement).
 *
 * Sans `--apply` : LECTURE SEULE, agrégats sans identifiant. Avec `--apply` : `--backup <fichier>`
 * obligatoire (créé, jamais écrasé), écrit AVANT toute modification.
 *
 * Quatre cas par trade touché :
 *  - CSV            (CSV_IMPORT) : seul le P&L est faux → P&L et empreinte d'import corrigés.
 *  - JUMEAU         (historique) : le trade juste existe déjà (réimporté depuis le déploiement) →
 *                   annotations recopiées sur lui, le faux est supprimé.
 *  - REIMPORT       (historique, connexion CONNECTED) : le sens et l'heure de clôture peuvent aussi
 *                   être faux (la vente restait en heure locale) et l'heure réelle n'est PAS en base →
 *                   trade supprimé, historique de la connexion remis à réimporter (`historyImportedAt`
 *                   vide, le cron de fond le reprend). Annotations reposées ensuite par `--reattach`.
 *  - FIGE           (historique, connexion absente ou à reconnecter) : P&L et empreinte corrigés ;
 *                   sens et heure non vérifiables. `--reattach` fusionne plus tard si un jumeau apparaît.
 *
 * Puis, pour ce qui a bougé : barème comportemental des comptes, totaux des séances clôturées,
 * chiffres des récaps quotidiens (texte IA conservé), référence comportementale supprimée (elle se
 * recalcule à la lecture suivante). Débriefs hebdo, alertes et incidents : comptés, jamais touchés
 * (régénération IA = décision de Greg). Cache analytics : expire seul en 5 min (CACHE_TTL.ANALYTICS).
 *
 * ORDRE : déployer le correctif PUIS lancer ce script sans attendre (le rattrapage du mois en cours
 * recrée les trades justes à côté des faux ; ils sont alors traités en JUMEAU). `--reattach`
 * une fois les réimportations terminées (connexions dont `historyImportedAt` est revenu) ; les
 * trades jamais réimportés y sont restaurés depuis la sauvegarde, P&L corrigé (`--restore-pending`).
 *
 * Exécution dans le conteneur API (DATABASE_URL déjà présent), comme `close-sessions.ts` :
 *   pnpm exec esbuild apps/api-mytradingcoach/scripts/repair-tradovate-pnl-milliers.ts --bundle --platform=node \
 *     --tsconfig=apps/api-mytradingcoach/tsconfig.app.json \
 *     --external:@prisma/client --external:@prisma/adapter-pg --external:pg --outfile=repair-pnl.js
 *   docker cp repair-pnl.js <conteneur>:/app/ && docker exec <conteneur> node /app/repair-pnl.js
 *   … node /app/repair-pnl.js --apply --backup /app/repair-pnl-backup.jsonl
 *   … node /app/repair-pnl.js --reattach /app/repair-pnl-backup.jsonl [--restore-pending] [--apply]
 */
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { BrokerConnectionStatus, Prisma, PrismaClient, SessionStatus, TradeSource } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { computeTradeStats, roundCents } from '@mtc/shared';
import { brutDepuisPrix, estTronque, VALEUR_DU_POINT } from '../src/modules/trades/pnl-milliers.util';
import { parseTradovatePnl } from '../src/modules/trades/csv-parsers';
import { dedupeKey, occurrenceHash } from '../src/modules/trades/trade-identity.util';
import { calculateRiskReward } from '../src/modules/trades/trade-metrics.util';
import { recomputeBehavioralGrades } from '../src/modules/trades/behavioral-grades';
import { sessionTotalsFrom } from '../src/modules/session/session-totals';
import { demoAccountIds, excludeAccountsWhere } from '../src/modules/accounts/demo-accounts';
import { inactiveAccountsTradeWhere } from '../src/modules/accounts/account-status-scope';
import type { CreateTradeDto } from '../src/modules/trades/dto/create-trade.dto';
import type { PrismaService } from '../src/prisma/prisma.service';

type Trade = Prisma.TradeGetPayload<object>;
type Cas = 'CSV' | 'JUMEAU' | 'REIMPORT' | 'FIGE';
type LigneSauvegarde =
  | { type: 'trade'; cas: Cas; jumeauId?: string; row: Trade }
  | { type: 'session'; row: unknown }
  | { type: 'recap'; row: unknown }
  | { type: 'baseline'; row: unknown }
  | { type: 'connexion'; id: string; historyImportedAt: string | null };

/** Fenêtre de recherche d'un jumeau : l'heure enregistrée peut être décalée du fuseau ou de la durée. */
const FENETRE_JUMEAU_MS = 6 * 3600_000;
const SOURCES_HISTO: TradeSource[] = [TradeSource.BROKER_HISTORY, TradeSource.BROKER_SYNC, TradeSource.CSV_IMPORT];

/** Le bundle exécuté porte-t-il le correctif ? Refus d'écrire sinon (script et API du même commit). */
function assertCorrectifPresent() {
  if (parseTradovatePnl('$1,125.00') !== 1125) throw new Error('bundle sans le correctif parseTradovatePnl : rien n’est écrit');
}

function brut(t: Trade): number {
  return brutDepuisPrix({ asset: t.asset, side: t.side, entry: t.entry, exit: t.exit, quantity: t.quantity }) as number;
}

const memesPrix = (a: Trade, b: Trade) =>
  (a.entry === b.entry && a.exit === b.exit) || (a.entry === b.exit && a.exit === b.entry);

/** Trade juste correspondant (réimporté par le code corrigé) : même compte, actif, quantité, prix et P&L. */
async function chercherJumeau(prisma: PrismaClient, t: Trade, exclus: Set<string>): Promise<Trade | null> {
  const attendu = brut(t);
  const candidats = await prisma.trade.findMany({
    where: {
      userId: t.userId,
      accountId: t.accountId,
      asset: t.asset,
      quantity: t.quantity,
      source: { in: SOURCES_HISTO },
      id: { notIn: [...exclus, t.id] },
      tradedAt: { gte: new Date(t.tradedAt.getTime() - FENETRE_JUMEAU_MS), lte: new Date(t.tradedAt.getTime() + FENETRE_JUMEAU_MS) },
    },
    orderBy: { tradedAt: 'asc' },
  });
  return candidats.find((c) => c.pnl != null && Math.abs(c.pnl - attendu) < 0.01 && memesPrix(c, t)) ?? null;
}

/** Empreinte d'import des valeurs corrigées : la clé, puis `#2`, `#3`… si elle est déjà prise. */
async function empreinteLibre(prisma: PrismaClient, t: Trade, pnl: number): Promise<string> {
  const key = dedupeKey({ ...t, pnl });
  for (let n = 1; ; n++) {
    const h = occurrenceHash(key, n);
    const pris = await prisma.trade.findFirst({ where: { userId: t.userId, importHash: h, id: { not: t.id } }, select: { id: true } });
    if (!pris) return h;
  }
}

/** Annotations saisies par l'utilisateur, recopiées sur le trade juste là où il n'a rien. */
function annotations(de: Trade, vers: Trade): Prisma.TradeUncheckedUpdateInput {
  const data: Prisma.TradeUncheckedUpdateInput = {};
  if (de.emotion && !vers.emotion) data.emotion = de.emotion;
  if (de.notes && !vers.notes) data.notes = de.notes;
  if (de.tags.length && !vers.tags.length) data.tags = de.tags;
  if (de.setupId !== vers.setupId) data.setupId = de.setupId;
  if (de.sessionId && !vers.sessionId) data.sessionId = de.sessionId;
  if (de.stopLoss != null && vers.stopLoss == null) data.stopLoss = de.stopLoss;
  if (de.takeProfit != null && vers.takeProfit == null) data.takeProfit = de.takeProfit;
  if (data.stopLoss !== undefined || data.takeProfit !== undefined) {
    data.riskReward = calculateRiskReward({
      ...vers,
      stopLoss: (data.stopLoss as number | undefined) ?? vers.stopLoss,
      takeProfit: (data.takeProfit as number | undefined) ?? vers.takeProfit,
    } as unknown as CreateTradeDto) ?? null;
  }
  return data;
}

class Sauvegarde {
  private fd: number | null = null;
  constructor(private readonly chemin: string | null) {}
  ouvrir() {
    if (this.chemin) this.fd = openSync(this.chemin, 'wx'); // jamais d'écrasement
  }
  ecrire(l: LigneSauvegarde) {
    if (this.fd != null) writeSync(this.fd, `${JSON.stringify(l)}\n`);
  }
  fermer() {
    if (this.fd != null) { fsyncSync(this.fd); closeSync(this.fd); }
  }
}

/** Recalcul de ce qui dérive des trades modifiés. Sauvegarde les lignes avant écriture. */
async function recalculer(
  prisma: PrismaClient, apply: boolean, sauvegarde: Sauvegarde,
  comptes: Set<string>, sessions: Set<string>, jours: Map<string, Set<string>>,
) {
  const bilan = { comptes: comptes.size, seances: 0, recaps: 0, references: 0, debriefs: 0, alertes: 0, incidents: 0 };
  for (const id of sessions) {
    const s = await prisma.tradeSession.findUnique({ where: { id } });
    if (!s || s.status === SessionStatus.ACTIVE) continue; // séance en cours : totaux calculés à la volée
    bilan.seances++;
    if (!apply) continue;
    const trades = await prisma.trade.findMany({
      where: { userId: s.userId, sessionId: s.id, ...(s.accountId ? { accountId: s.accountId } : {}) },
      select: { pnl: true, commission: true, asset: true },
      orderBy: { tradedAt: 'asc' },
    });
    sauvegarde.ecrire({ type: 'session', row: s });
    await prisma.tradeSession.update({ where: { id }, data: sessionTotalsFrom(trades) });
  }
  for (const [userId, js] of jours) {
    const demo = await demoAccountIds(prisma as unknown as PrismaService, userId);
    for (const jour of js) {
      // Même journée LOCALE que `DailyRecapService.generateRecap` (même conteneur, même fuseau).
      const debut = new Date(`${jour}T00:00:00`);
      const fin = new Date(`${jour}T23:59:59.999`);
      const recap = await prisma.dailyRecap.findFirst({ where: { userId, date: { gte: debut, lte: fin } } });
      if (recap) {
        bilan.recaps++;
        if (apply) {
          const trades = await prisma.trade.findMany({
            where: { userId, tradedAt: { gte: debut, lte: fin }, pnl: { not: null }, AND: [excludeAccountsWhere(demo), inactiveAccountsTradeWhere()] },
            select: { pnl: true, commission: true },
          });
          const st = computeTradeStats(trades);
          sauvegarde.ecrire({ type: 'recap', row: recap });
          await prisma.dailyRecap.update({ where: { id: recap.id }, data: { tradesCount: trades.length, pnl: st.totalPnl, winRate: st.winRate } });
        }
      }
      bilan.debriefs += await prisma.weeklyDebrief.count({ where: { userId, startDate: { lte: fin }, endDate: { gte: debut } } });
      bilan.alertes += await prisma.behaviorAlert.count({ where: { userId, tradeDay: new Date(`${jour}T00:00:00.000Z`) } });
    }
    const ref = await prisma.behaviorBaseline.findUnique({ where: { userId } });
    if (ref) {
      bilan.references++;
      if (apply) {
        sauvegarde.ecrire({ type: 'baseline', row: ref });
        await prisma.behaviorBaseline.delete({ where: { userId } });
      }
    }
  }
  for (const accountId of comptes) {
    bilan.incidents += await prisma.accountIncident.count({ where: { accountId } });
    if (apply) await recomputeBehavioralGrades(prisma as unknown as PrismaService, accountId);
  }
  return bilan;
}

const jourLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function noter(jours: Map<string, Set<string>>, t: Trade) {
  const s = jours.get(t.userId) ?? new Set<string>();
  s.add(jourLocal(t.tradedAt));
  jours.set(t.userId, s);
}

async function reparer(prisma: PrismaClient, apply: boolean, sauvegarde: Sauvegarde) {
  const touches = (await prisma.trade.findMany({
    where: {
      source: { in: [TradeSource.CSV_IMPORT, TradeSource.BROKER_HISTORY] },
      asset: { in: [...VALEUR_DU_POINT.keys()] },
      exit: { not: null },
      pnl: { not: null },
    },
  })).filter((t) => estTronque(t));

  const connexions = new Map<string, { id: string; status: BrokerConnectionStatus; historyImportedAt: Date | null }>();
  const parCas: Record<Cas, number> = { CSV: 0, JUMEAU: 0, REIMPORT: 0, FIGE: 0 };
  let ecart = 0;
  const comptes = new Set<string>();
  const sessions = new Set<string>();
  const jours = new Map<string, Set<string>>();
  const aReimporter = new Set<string>();
  const jumeauxPris = new Set<string>();

  for (const t of touches) {
    const juste = brut(t);
    ecart += juste - (t.pnl as number);
    let cas: Cas = 'CSV';
    let jumeau: Trade | null = null;
    if (t.source === TradeSource.BROKER_HISTORY) {
      jumeau = await chercherJumeau(prisma, t, jumeauxPris);
      if (jumeau) cas = 'JUMEAU';
      else {
        if (t.accountId && !connexions.has(t.accountId)) {
          const c = await prisma.brokerConnection.findFirst({
            where: { accountId: t.accountId, provider: 'TRADOVATE' },
            select: { id: true, status: true, historyImportedAt: true },
          });
          if (c) connexions.set(t.accountId, c);
        }
        const c = t.accountId ? connexions.get(t.accountId) : undefined;
        cas = c?.status === BrokerConnectionStatus.CONNECTED ? 'REIMPORT' : 'FIGE';
        if (cas === 'REIMPORT' && c) aReimporter.add(c.id);
      }
    }
    parCas[cas]++;
    if (t.accountId) comptes.add(t.accountId);
    if (t.sessionId) sessions.add(t.sessionId);
    if (jumeau?.sessionId) sessions.add(jumeau.sessionId);
    noter(jours, t);
    if (jumeau) { jumeauxPris.add(jumeau.id); noter(jours, jumeau); }
    if (!apply) continue;

    sauvegarde.ecrire({ type: 'trade', cas, jumeauId: jumeau?.id, row: t });
    if (cas === 'CSV' || cas === 'FIGE') {
      await prisma.trade.update({ where: { id: t.id }, data: { pnl: juste, importHash: await empreinteLibre(prisma, t, juste) } });
    } else if (cas === 'JUMEAU' && jumeau) {
      await prisma.$transaction([
        prisma.trade.update({ where: { id: jumeau.id }, data: annotations(t, jumeau) }),
        prisma.trade.delete({ where: { id: t.id } }),
      ]);
    } else {
      await prisma.trade.delete({ where: { id: t.id } });
    }
  }

  for (const c of connexions.values()) {
    if (!aReimporter.has(c.id)) continue;
    if (!apply) continue;
    sauvegarde.ecrire({ type: 'connexion', id: c.id, historyImportedAt: c.historyImportedAt?.toISOString() ?? null });
    await prisma.brokerConnection.update({ where: { id: c.id }, data: { historyImportedAt: null } });
  }

  const recalcul = await recalculer(prisma, apply, sauvegarde, comptes, sessions, jours);
  return {
    trades: touches.length,
    utilisateurs: new Set(touches.map((t) => t.userId)).size,
    comptes: comptes.size,
    ecartPnlTotal: roundCents(ecart),
    parSource: {
      CSV_IMPORT: touches.filter((t) => t.source === TradeSource.CSV_IMPORT).length,
      BROKER_HISTORY: touches.filter((t) => t.source === TradeSource.BROKER_HISTORY).length,
    },
    parCas,
    connexionsAReimporter: aReimporter.size,
    recalcul,
  };
}

/**
 * Après réimportation : annotations reposées sur les trades justes, faux résiduels (FIGE) fusionnés
 * s'ils ont maintenant un jumeau, et — avec `--restore-pending` seulement — trades REIMPORT jamais
 * revenus restaurés depuis la sauvegarde avec leur P&L corrigé.
 */
async function rattacher(prisma: PrismaClient, apply: boolean, fichier: string, restaurer: boolean, sauvegarde: Sauvegarde) {
  const lignes = readFileSync(fichier, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as LigneSauvegarde);
  const bilan = { reposes: 0, fusionnes: 0, enAttente: 0, restaures: 0, nonRestaures: 0, dejaFaits: 0 };
  const comptes = new Set<string>();
  const sessions = new Set<string>();
  const jours = new Map<string, Set<string>>();
  const pris = new Set<string>();

  for (const l of lignes) {
    if (l.type !== 'trade' || (l.cas !== 'REIMPORT' && l.cas !== 'FIGE')) continue;
    const row = { ...l.row, tradedAt: new Date(l.row.tradedAt), createdAt: new Date(l.row.createdAt) } as Trade;
    const encoreLa = !!(await prisma.trade.findUnique({ where: { id: row.id }, select: { id: true } }));
    // FIGE : rien à faire s'il a déjà été fusionné. REIMPORT : rien s'il a déjà été restauré (rejeu).
    if (l.cas === 'FIGE' ? !encoreLa : encoreLa) { bilan.dejaFaits++; continue; }
    const jumeau = await chercherJumeau(prisma, row, pris);
    if (jumeau) {
      pris.add(jumeau.id);
      const data = annotations(row, jumeau);
      if (l.cas === 'REIMPORT' && Object.keys(data).length === 0) { bilan.dejaFaits++; continue; }
      if (l.cas === 'REIMPORT') bilan.reposes++;
      else bilan.fusionnes++;
      if (jumeau.accountId) comptes.add(jumeau.accountId);
      if (row.sessionId) sessions.add(row.sessionId);
      noter(jours, jumeau);
      if (!apply) continue;
      const ops: Prisma.PrismaPromise<unknown>[] = [prisma.trade.update({ where: { id: jumeau.id }, data })];
      if (l.cas === 'FIGE') {
        sauvegarde.ecrire({ type: 'trade', cas: 'JUMEAU', jumeauId: jumeau.id, row: await prisma.trade.findUniqueOrThrow({ where: { id: row.id } }) });
        ops.push(prisma.trade.delete({ where: { id: row.id } }));
      }
      await prisma.$transaction(ops);
      continue;
    }
    if (l.cas === 'FIGE') continue;
    const conn = row.accountId
      ? await prisma.brokerConnection.findFirst({ where: { accountId: row.accountId, provider: 'TRADOVATE' }, select: { historyImportedAt: true } })
      : null;
    if (conn && !conn.historyImportedAt && !restaurer) { bilan.enAttente++; continue; }
    if (!restaurer) { bilan.nonRestaures++; continue; }
    bilan.restaures++;
    if (row.accountId) comptes.add(row.accountId);
    if (row.sessionId) sessions.add(row.sessionId);
    noter(jours, row);
    if (!apply) continue;
    const pnl = brut(row);
    await prisma.trade.create({ data: { ...row, pnl, importHash: await empreinteLibre(prisma, row, pnl) } as Prisma.TradeUncheckedCreateInput });
  }
  const recalcul = await recalculer(prisma, apply, sauvegarde, comptes, sessions, jours);
  return { ...bilan, recalcul };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const valeur = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] ?? null : null; };
  const reattach = valeur('--reattach');
  const backup = valeur('--backup');
  if (apply && !backup) throw new Error('--apply exige --backup <fichier> (nouveau fichier, jamais écrasé)');
  assertCorrectifPresent();

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as ConstructorParameters<typeof PrismaClient>[0]);
  const sauvegarde = new Sauvegarde(apply ? backup : null);
  sauvegarde.ouvrir();
  try {
    const bilan = reattach
      ? await rattacher(prisma, apply, reattach, args.includes('--restore-pending'), sauvegarde)
      : await reparer(prisma, apply, sauvegarde);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', phase: reattach ? 'reattach' : 'reparation', ...bilan }, null, 2));
  } finally {
    sauvegarde.fermer();
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
