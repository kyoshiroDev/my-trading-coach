/**
 * #1063 (doute promu au tri du lot 4) : la recherche admin passe par `contains` + `mode: 'insensitive'`
 * de Prisma, soit un ILIKE '%…%'. Sur une vraie base : `_` et `%` tapés par l'admin sont cherchés tels
 * quels (escapeLike), sans double échappement (« a_b » retrouve bien « a_b »). Ce qu'un mock ne prouve pas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

const PREFIX = 'int-search-';
const uid = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

let app: INestApplication;
let prisma: PrismaService;
let users: UsersService;

beforeAll(async () => {
  ({ app } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  users = app.get(UsersService);
  for (const local of ['a_b', 'axb', 'p%q', 'pzzq']) {
    await prisma.user.create({ data: { email: `${PREFIX}${uid}-${local}@test.local`, unsubToken: `${PREFIX}${uid}-${local}` } });
  }
}, 120_000);

afterAll(async () => {
  if (prisma) await prisma.user.deleteMany({ where: { email: { startsWith: `${PREFIX}${uid}` } } });
  await app?.close().catch(() => undefined);
});

const emailsFor = async (search: string) =>
  (await users.adminFindAll(1, 20, search)).users.map((u: { email: string }) => u.email).sort();

describe('Recherche admin : jokers cherchés tels quels (#1063)', () => {
  it('« _ » ne remplace pas un caractère : « a_b » trouve a_b, pas axb', async () => {
    expect(await emailsFor(`${uid}-a_b`)).toEqual([`${PREFIX}${uid}-a_b@test.local`]);
  });

  it('« % » ne remplace pas une suite : « p%q » trouve p%q, pas pzzq', async () => {
    expect(await emailsFor(`${uid}-p%q`)).toEqual([`${PREFIX}${uid}-p%q@test.local`]);
  });

  it('recherche ordinaire inchangée, casse ignorée', async () => {
    expect(await emailsFor(`${uid.toUpperCase()}-AXB`)).toEqual([`${PREFIX}${uid}-axb@test.local`]);
  });
});
