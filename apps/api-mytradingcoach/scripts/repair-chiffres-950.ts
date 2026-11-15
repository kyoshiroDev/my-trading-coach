/**
 * Réparation #950 : chiffres déjà faux en prod, trouvés par l'audit #947 (correctifs en prod depuis
 * le 11/11, lot 1). Règles de détection et valeurs justes : `src/modules/trades/repair-950.util.ts`.
 *
 * Sans `--apply` : LECTURE SEULE (simulation), agrégats sans identifiant ni donnée d'utilisateur.
 * Avec `--apply` : `--backup <fichier>` obligatoire (créé, jamais écrasé), chaque ligne écrite AVANT
 * d'être modifiée. Rejouable : un 2ᵉ passage ne trouve plus rien.
 *
 * Ce que le script répare (comptes démo exclus) :
 *  1. MEXC au P&L net (import CSV d'avant le lot 1) : P&L remis en brut et frais au centime, comme le
 *     parseur corrigé ; empreinte d'import recalculée (un ré-import du même fichier reste un doublon).
 *  2. Trades clôturés depuis la séance avec l'écart de prix comme P&L (créés avant le lot 1) : P&L
 *     recalculé en argent.
 *  3. Totaux des séances clôturées figés (TradingSession) : TOUTES les séances clôturées dont les
 *     totaux stockés diffèrent du recalcul (après 1 et 2, simulation comprise), et leurs dérivés.
 *  Puis, pour ce qui a bougé : barème comportemental des comptes, chiffres des récaps quotidiens
 *  (texte IA conservé), référence comportementale supprimée (recalculée à la lecture suivante).
 *  Débriefs hebdo, alertes et incidents : comptés, jamais touchés (régénération IA = décision de Greg).
 *  Cache analytics : expire seul en 5 min.
 *
 * Ce que le script NE répare PAS (pas l'information en base) :
 *  - Frais Tradovate d'un fill partagé (tout sur le 1er trade) : il faut les fills, donc la Reporting
 *    API. Fait par la réparation des frais de l'admin (`POST /api/admin/tradovate/repair-fees`), qui
 *    remet maintenant ces groupes au prorata. À lancer AVANT ce script (essai, puis `?apply=true`) :
 *    elle ne touche que `commission`, et ce script recalcule ensuite les séances, récaps et barèmes.
 *    Limite : un récap quotidien d'un jour Tradovate SANS séance garde son ancien P&L (chiffre seul).
 *  - Centimes perdus à la répartition d'un total de frais à l'import (9,99 $ pour 10 $) : le total
 *    saisi n'est pas stocké. Au plus 1 centime par import, non réparable.
 *
 * Exécution dans le conteneur API (DATABASE_URL déjà présent), comme le script #780 :
 *   pnpm exec esbuild apps/api-mytradingcoach/scripts/repair-chiffres-950.ts --bundle --platform=node \
 *     --tsconfig=apps/api-mytradingcoach/tsconfig.app.json \
 *     --external:@prisma/client --external:@prisma/adapter-pg --external:pg --outfile=repair-950.js
 *   docker cp repair-950.js <conteneur>:/app/ && docker exec <conteneur> node /app/repair-950.js
 *   … node /app/repair-950.js --apply --backup /app/repair-950-backup.jsonl
 */
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { Prisma, PrismaClient, SessionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { computeTradeStats, roundCents } from '@mtc/shared';
import {
  estClotureEcartDePrix,
  estMexcAmbigu,
  estMexcAuNet,
  pnlCloture,
  totauxDifferents,
  valeursMexcCorrigees,
} from '../src/modules/trades/repair-950.util';
import { parseMexc } from '../src/modules/trades/csv-parsers';
import { planFeeRepairs } from '../src/modules/integrations/tradovate/tradovate-fees-repair';
import { dedupeKey, occurrenceHash } from '../src/modules/trades/trade-identity.util';
import { recomputeBehavioralGrades } from '../src/modules/trades/behavioral-grades';
import { sessionTotalsFrom } from '../src/modules/session/session-totals';
import { demoAccountIds, excludeAccountsWhere } from '../src/modules/accounts/demo-accounts';
import { inactiveAccountsTradeWhere } from '../src/modules/accounts/account-status-scope';
import type { PrismaService } from '../src/prisma/prisma.service';

type Trade = Prisma.TradeGetPayload<object>;
type Cas = 'MEXC_NET' | 'CLOTURE_ECART_PRIX';
type LigneSauvegarde =
  | { type: 'trade'; cas: Cas; row: Trade }
  | { type: 'session'; row: unknown }
  | { type: 'recap'; row: unknown }
  | { type: 'baseline'; row: unknown };

/** Le bundle exécuté porte-t-il les correctifs ? Refus de tourner sinon (script et API du même commit). */
function assertCorrectifsPresents() {
  const header = 'Futures,Close Time,Avg Entry Price,Avg Close Price,Direction,Closing Qty,Trading Fee,Realized PNL,Status';
  const [, ligne] = parseMexc([header, 'BTCUSDT,2026-05-30 14:31:55,1,2,long,1,1.6203 USDT,-6.5727459 USDT,Closed']).split('\n');
  if (Number(ligne?.split(',')[5]) !== -4.95) throw new Error('bundle sans le correctif MEXC (74f6ad26) : rien n’est lu');
  if (planFeeRepairs([], []).redistributed !== 0) throw new Error('bundle sans la répartition des fills partagés (#950)');
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

/** Empreinte d'import des valeurs corrigées : la clé, puis `#2`, `#3`… si elle est déjà prise. */
async function empreinteLibre(prisma: PrismaClient, t: Trade, pnl: number): Promise<string> {
  const key = dedupeKey({ ...t, pnl });
  for (let n = 1; ; n++) {
    const h = occurrenceHash(key, n);
    const pris = await prisma.trade.findFirst({ where: { userId: t.userId, importHash: h, id: { not: t.id } }, select: { id: true } });
    if (!pris) return h;
  }
}

const jourLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function noter(jours: Map<string, Set<string>>, t: { userId: string; tradedAt: Date }) {
  const s = jours.get(t.userId) ?? new Set<string>();
  s.add(jourLocal(t.tradedAt));
  jours.set(t.userId, s);
}

async function reparer(prisma: PrismaClient, apply: boolean, sauvegarde: Sauvegarde) {
  const reels = { user: { isDemo: false } };

  // ── 1 et 2 : trades faux ────────────────────────────────────────────────────────────────────────
  const candidats = await prisma.trade.findMany({
    where: {
      ...reels,
      pnl: { not: null },
      OR: [
        { source: 'CSV_IMPORT', commission: { gt: 0 } }, // symbole filtré en JS (`estMexcAuNet`)
        { exit: { not: null }, tags: { hasSome: ['SL', 'TP', 'MANUAL'] } },
      ],
    },
  });
  const corrections = new Map<string, { cas: Cas; pnl: number; commission?: number }>();
  let ambigusMexc = 0;
  for (const t of candidats) {
    if (estMexcAuNet(t)) {
      const v = valeursMexcCorrigees(t);
      corrections.set(t.id, { cas: 'MEXC_NET', pnl: v.pnl, commission: v.commission });
    } else if (estClotureEcartDePrix(t)) {
      corrections.set(t.id, { cas: 'CLOTURE_ECART_PRIX', pnl: pnlCloture(t) as number });
    } else if (estMexcAmbigu(t)) {
      ambigusMexc++;
    }
  }

  const parCas: Record<Cas, { trades: number; utilisateurs: number; ecartNet: number }> = {
    MEXC_NET: { trades: 0, utilisateurs: 0, ecartNet: 0 },
    CLOTURE_ECART_PRIX: { trades: 0, utilisateurs: 0, ecartNet: 0 },
  };
  const usersParCas: Record<Cas, Set<string>> = { MEXC_NET: new Set(), CLOTURE_ECART_PRIX: new Set() };
  const comptes = new Set<string>();
  const jours = new Map<string, Set<string>>();
  for (const t of candidats) {
    const c = corrections.get(t.id);
    if (!c) continue;
    const netAvant = (t.pnl as number) - (t.commission ?? 0);
    const netApres = c.pnl - (c.commission ?? t.commission ?? 0);
    parCas[c.cas].trades++;
    parCas[c.cas].ecartNet += netApres - netAvant;
    usersParCas[c.cas].add(t.userId);
    if (t.accountId) comptes.add(t.accountId);
    noter(jours, t);
    if (!apply) continue;
    sauvegarde.ecrire({ type: 'trade', cas: c.cas, row: t });
    await prisma.trade.update({
      where: { id: t.id },
      data: {
        pnl: c.pnl,
        ...(c.commission !== undefined ? { commission: c.commission } : {}),
        ...(t.importHash ? { importHash: await empreinteLibre(prisma, t, c.pnl) } : {}),
      },
    });
  }
  for (const cas of Object.keys(parCas) as Cas[]) {
    parCas[cas].utilisateurs = usersParCas[cas].size;
    parCas[cas].ecartNet = roundCents(parCas[cas].ecartNet);
  }

  // ── 3 : totaux des séances clôturées ────────────────────────────────────────────────────────────
  // Même lecture que `sessionTradesFor` (1 séance = 1 compte), corrections 1-2 appliquées en mémoire :
  // la simulation compte déjà les séances que ces corrections changent.
  const seances = await prisma.tradeSession.findMany({ where: { ...reels, status: SessionStatus.CLOSED } });
  let seancesFausses = 0;
  let ecartTotalSeances = 0;
  for (const s of seances) {
    const trades = (await prisma.trade.findMany({
      where: { userId: s.userId, sessionId: s.id, ...(s.accountId ? { accountId: s.accountId } : {}) },
      select: { id: true, pnl: true, commission: true, asset: true, tradedAt: true, accountId: true },
      orderBy: { tradedAt: 'asc' },
    })).map((t) => {
      const c = corrections.get(t.id);
      return c ? { ...t, pnl: c.pnl, commission: c.commission ?? t.commission } : t;
    });
    const juste = sessionTotalsFrom(trades);
    if (!totauxDifferents(s, juste)) continue;
    seancesFausses++;
    // Séance faussée par autre chose que 1-2 (frais Tradovate réparés avant) : ses récaps et le
    // barème de son compte suivent aussi.
    for (const t of trades) if (t.tradedAt) noter(jours, { userId: s.userId, tradedAt: t.tradedAt });
    if (s.accountId) comptes.add(s.accountId);
    ecartTotalSeances += (juste.totalPnl ?? 0) - (s.totalPnl ?? 0);
    if (!apply) continue;
    sauvegarde.ecrire({ type: 'session', row: s });
    await prisma.tradeSession.update({ where: { id: s.id }, data: juste });
  }

  // ── Dérivés des trades corrigés ─────────────────────────────────────────────────────────────────
  const bilan = { comptes: comptes.size, recaps: 0, references: 0, debriefsConcernes: 0, alertesConcernees: 0, incidentsConcernes: 0 };
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
      bilan.debriefsConcernes += await prisma.weeklyDebrief.count({ where: { userId, startDate: { lte: fin }, endDate: { gte: debut } } });
      bilan.alertesConcernees += await prisma.behaviorAlert.count({ where: { userId, tradeDay: new Date(`${jour}T00:00:00.000Z`) } });
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
    bilan.incidentsConcernes += await prisma.accountIncident.count({ where: { accountId } });
    if (apply) await recomputeBehavioralGrades(prisma as unknown as PrismaService, accountId);
  }

  return {
    trades: {
      ...parCas,
      mexcAmbigusNonTouches: ambigusMexc,
      utilisateurs: new Set(candidats.filter((t) => corrections.has(t.id)).map((t) => t.userId)).size,
    },
    seances: { cloturees: seances.length, totauxFaux: seancesFausses, ecartTotalPnl: roundCents(ecartTotalSeances) },
    recalcul: bilan,
    avant: 'réparation des frais Tradovate (fills partagés) faite AVANT ce script : POST /api/admin/tradovate/repair-fees (essai), puis ?apply=true',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const i = args.indexOf('--backup');
  const backup = i >= 0 ? args[i + 1] ?? null : null;
  if (apply && !backup) throw new Error('--apply exige --backup <fichier> (nouveau fichier, jamais écrasé)');
  assertCorrectifsPresents();

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as ConstructorParameters<typeof PrismaClient>[0]);
  const sauvegarde = new Sauvegarde(apply ? backup : null);
  sauvegarde.ouvrir();
  try {
    const bilan = await reparer(prisma, apply, sauvegarde);
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...bilan }, null, 2));
  } finally {
    sauvegarde.fermer();
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
