/**
 * Filtre des campagnes de test (#1029) sur une vraie base : le SQL de `notTestAcquisitionSql`
 * (LIKE ANY, jokers échappés) : exact ou préfixe, sans casse, jamais « contient ».
 * Lignes en `VALUES` : rien n'est écrit en base.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { anonymousAcquisitionSql } from './test-acquisition';

let app: INestApplication;
let prisma: PrismaService;

type Row = [string, string, string];
const ROWS: Row[] = [
  ['ninjatrader', 'newsletter', 'test-prod-essai'],
  ['ninjatrader', 'newsletter', 'newsletter-novembre-2026'],
  ['instagram', 'paid', 'test-greg4'],
  ['ami', 'test', 'lecture'],
  ['instagram', 'paid', 'gratuit-reel'],
  ['contest', 'latest-promo', 'testament'],
  ['amis-trading', 'miami', ''],
  ['TEST', '', ''],
  ['', '', ''],
  // Jokers littéraux : « test_x » ne doit pas être pris pour « test-x » ni « ami% » pour « amitie ».
  ['test_greg', 'ami%', 'a_b'],
];

/** Lignes gardées par le filtre SQL, dans l'ordre de `ROWS`. */
async function kept(includeTests: boolean): Promise<Row[]> {
  const values = Prisma.join(ROWS.map((r, i) => Prisma.sql`(${i}, ${r[0]}, ${r[1]}, ${r[2]})`));
  const rows = await prisma.$queryRaw<{ i: number }[]>`
    SELECT "i" FROM (VALUES ${values}) AS t("i", "source", "medium", "campaign")
    WHERE ${anonymousAcquisitionSql(includeTests)}
    ORDER BY "i"`;
  return rows.map((r) => ROWS[Number(r.i)]);
}

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
}, 120_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
});

describe('Campagnes de test exclues de l’admin Acquisition (#1029)', () => {
  it('SQL = règle partagée : exact ou préfixe, jamais « contient »', async () => {
    const real = await kept(false);
    expect(real).toEqual([
      ['ninjatrader', 'newsletter', 'newsletter-novembre-2026'],
      ['instagram', 'paid', 'gratuit-reel'],
      ['contest', 'latest-promo', 'testament'],
      ['amis-trading', 'miami', ''],
      ['', '', ''],
      ['test_greg', 'ami%', 'a_b'],
    ]);
    expect(real).toContainEqual(['ninjatrader', 'newsletter', 'newsletter-novembre-2026']);
    expect(real).not.toContainEqual(['ninjatrader', 'newsletter', 'test-prod-essai']);
    expect(real).toContainEqual(['contest', 'latest-promo', 'testament']);
    expect(real).toContainEqual(['amis-trading', 'miami', '']);
    expect(real).toContainEqual(['test_greg', 'ami%', 'a_b']);
    expect(real).not.toContainEqual(['TEST', '', '']);
  });

  it('« Inclure les tests » : toutes les lignes', async () => {
    expect(await kept(true)).toEqual(ROWS);
  });
});
