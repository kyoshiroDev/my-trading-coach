import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { groupTrades, summaryTotals, cumulativeByTrade, processTimeZone, type GroupKey } from './analytics.sql';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Génération des requêtes (sans base) : filtres présents, valeurs en PARAMÈTRES LIÉS (aucune
 * concaténation : pas d'injection possible), jointure des sessions seulement pour l'émotion.
 * L'exactitude des résultats est vérifiée sur vrai Postgres (analytics-sql-equivalence.int-spec.ts).
 */
const queryRaw = vi.fn();
const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
// `$queryRaw` est un tag de template : (morceaux de texte, ...valeurs). On recompose la requête
// comme Prisma, pour lire son texte (placeholders $1, $2…) et ses valeurs liées.
const lastSql = (): Prisma.Sql => {
  const [strings, ...values] = queryRaw.mock.calls.at(-1) as [TemplateStringsArray, ...unknown[]];
  return Prisma.sql(strings, ...values);
};
const text = () => lastSql().text.replace(/\s+/g, ' ');

beforeEach(() => queryRaw.mockReset().mockResolvedValue([]));

describe('groupTrades', () => {
  it('filtres utilisateur, compte, période : tous en paramètres liés', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    const before = new Date('2026-03-01');
    await groupTrades(prisma, { userId: "u1' OR 1=1 --", accountId: 'acc-9', from, to, before }, 'asset');
    expect(text()).toContain('t."userId" = $');
    expect(text()).toContain('t."accountId" = $');
    expect(text()).toContain('t."tradedAt" >= $');
    expect(text()).toContain('t."tradedAt" <= $');
    expect(text()).toContain('t."tradedAt" < $');
    expect(text()).toContain('t."pnl" IS NOT NULL');
    expect(lastSql().values).toEqual(expect.arrayContaining(["u1' OR 1=1 --", 'acc-9', from, to, before]));
    expect(text()).not.toContain('OR 1=1'); // la valeur n'est jamais dans le texte SQL
  });

  it('sans compte ni période : aucun filtre superflu', async () => {
    await groupTrades(prisma, { userId: 'u1' }, 'setup');
    expect(text()).not.toContain('"accountId"');
    expect(text()).not.toContain('"tradedAt" >=');
  });

  it('jointure TradeSession uniquement pour l’émotion effective', async () => {
    await groupTrades(prisma, { userId: 'u1' }, 'emotion');
    expect(text()).toContain('LEFT JOIN "TradeSession" s');
    expect(text()).toContain('coalesce(t."emotion"::text, s."moodStart"::text)');
    await groupTrades(prisma, { userId: 'u1' }, 'setup');
    expect(text()).not.toContain('TradeSession');
  });

  it('heure et jour dans le fuseau demandé (paramètre lié), dates d’activité à Paris', async () => {
    await groupTrades(prisma, { userId: 'u1' }, 'dayHour', 'America/New_York');
    expect(lastSql().values).toContain('America/New_York');
    expect(text()).toContain('extract(dow from');
    await groupTrades(prisma, { userId: 'u1' }, 'parisDate');
    expect(text()).toContain("AT TIME ZONE 'Europe/Paris'");
  });

  it('chaque clé de la liste blanche produit une requête groupée et triée par premier trade', async () => {
    for (const k of ['setup', 'emotion', 'asset', 'session', 'hour', 'dayHour', 'parisDate'] as GroupKey[]) {
      await groupTrades(prisma, { userId: 'u1' }, k);
      expect(text()).toContain('GROUP BY 1');
      expect(text()).toContain('ORDER BY min(t."tradedAt")');
    }
  });

  it('net = round((pnl − |commission|)::text::numeric, 2) (≡ netPnl / roundCents) ; R:R compté seulement s’il est renseigné et non nul', async () => {
    await groupTrades(prisma, { userId: 'u1' }, 'asset');
    expect(text()).toContain('round((t."pnl" - abs(coalesce(t."commission", 0)))::text::numeric, 2)'); // ≡ roundCents
    expect(text()).toContain(`t."riskReward" IS NOT NULL AND t."riskReward" <> 0 AND t."riskReward" <> 'NaN'`);
  });
});

describe('summaryTotals / cumulativeByTrade', () => {
  it('résumé : drawdown et série en fenêtres, ordre (tradedAt, id) déterministe', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 0 }]);
    await summaryTotals(prisma, { userId: 'u1', from: new Date('2026-01-01') });
    expect(text()).toContain('ORDER BY "tradedAt", "id" ROWS UNBOUNDED PRECEDING');
    expect(text()).toContain('greatest(0, max(cum)');
    expect(lastSql().values).toContain('u1');
  });

  it('courbe par trade : cumul ordonné', async () => {
    await cumulativeByTrade(prisma, { userId: 'u1', accountId: 'a1' });
    expect(text()).toContain('ORDER BY t."tradedAt", t."id"');
    expect(lastSql().values).toEqual(expect.arrayContaining(['u1', 'a1']));
  });

  it('processTimeZone renvoie le fuseau du processus (celui de getHours)', () => {
    expect(processTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
