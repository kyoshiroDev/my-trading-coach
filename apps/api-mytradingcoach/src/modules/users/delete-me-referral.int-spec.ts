/**
 * Régression — un parrain ne pouvait plus supprimer son compte.
 *
 * `ReferralCommission.ambassadorId` et `ReferralReward.parrainId` étaient les deux
 * seules FK vers `User` sans règle `onDelete` : Postgres appliquait donc RESTRICT.
 * `archiveAndDelete` échouait sur violation de contrainte, la transaction annulait
 * jusqu'à la trace RGPD, et le front n'affichait rien (corrigé séparément).
 *
 * Pourquoi une vraie base : le comportement testé EST la contrainte Postgres. Un double
 * Prisma ne connaît aucune FK — il laisserait passer la suppression même avec RESTRICT
 * en place, c'est-à-dire avec le bug intact. Seul le vrai moteur peut le prouver.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createIntegrationApp } from '../../test/integration-app.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

const PREFIX = 'int-delete-referral-';

let app: INestApplication;
let prisma: PrismaService;
let users: UsersService;
let baseUrl: string;

const uid = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

interface RegisterResponse {
  data: { access_token: string; user: { id: string } };
}

async function registerUser(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${PREFIX}${uid()}@test.local`,
      password: 'int-test-no-login-1234',
      name: 'Int Delete Referral',
    }),
  });
  if (!res.ok) throw new Error(`register → ${res.status} : ${await res.text()}`);
  return ((await res.json()) as RegisterResponse).data.user.id;
}

beforeAll(async () => {
  // Bootstrap partagé : ResendService neutralisé, aucun vrai email envoyé.
  ({ app, baseUrl } = await createIntegrationApp());
  prisma = app.get(PrismaService);
  users = app.get(UsersService);
}, 120_000);

afterAll(async () => {
  if (prisma) {
    await prisma.deletedAccount.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  await app?.close().catch(() => undefined);
});

describe('deleteMe — le parrainage ne bloque plus la suppression', () => {
  it('ambassadeur avec une commission : suppression aboutie, commission emportée', async () => {
    const ambassadeurId = await registerUser();
    const filleulId = await registerUser();
    await prisma.referralCommission.create({
      data: {
        ambassadorId: ambassadeurId,
        referredUserId: filleulId,
        amount: 9.8,
        subscriptionId: `sub_${uid()}`,
        period: '2026-08',
      },
    });

    await expect(
      users.deleteMe(ambassadeurId, 'Autre'),
      'RESTRICT encore en place : le compte reste, et le front n\'en dit rien',
    ).resolves.toBeUndefined();

    expect(await prisma.user.findUnique({ where: { id: ambassadeurId } })).toBeNull();
    expect(
      await prisma.referralCommission.count({ where: { ambassadorId: ambassadeurId } }),
      'Commission orpheline laissée derrière',
    ).toBe(0);
  });

  it('parrain avec un mois offert : suppression aboutie, récompense emportée', async () => {
    const parrainId = await registerUser();
    const filleulId = await registerUser();
    await prisma.referralReward.create({
      data: {
        parrainId,
        filleulId,
        subscriptionId: `sub_${uid()}`,
        amountEur: 49,
      },
    });

    await expect(users.deleteMe(parrainId, 'Autre')).resolves.toBeUndefined();

    expect(await prisma.user.findUnique({ where: { id: parrainId } })).toBeNull();
    expect(await prisma.referralReward.count({ where: { parrainId } })).toBe(0);
  });

  it('la trace RGPD survit à la suppression', async () => {
    // La trace et le delete vivent dans la MÊME transaction : un échec de la FK
    // annulait aussi l'archive. Sa présence prouve que la transaction a commité.
    const parrainId = await registerUser();
    const filleulId = await registerUser();
    const user = await prisma.user.findUnique({ where: { id: parrainId } });
    await prisma.referralReward.create({
      data: { parrainId, filleulId, subscriptionId: `sub_${uid()}`, amountEur: 49 },
    });

    await users.deleteMe(parrainId, 'Trop cher');

    const trace = await prisma.deletedAccount.findFirst({
      where: { email: user!.email },
      orderBy: { deletedAt: 'desc' },
    });
    expect(trace, 'Aucune trace : la transaction a été annulée').toBeTruthy();
    expect(trace!.deletedBy).toBe('self');
    expect(trace!.reason).toBe('Trop cher');
  });

  it('le filleul n\'est pas emporté par le départ de son parrain', async () => {
    // Cascade ne doit toucher QUE les lignes de parrainage, jamais l'autre utilisateur.
    const parrainId = await registerUser();
    const filleulId = await registerUser();
    await prisma.referralReward.create({
      data: { parrainId, filleulId, subscriptionId: `sub_${uid()}`, amountEur: 49 },
    });

    await users.deleteMe(parrainId, undefined);

    expect(
      await prisma.user.findUnique({ where: { id: filleulId } }),
      'Le filleul a été supprimé avec son parrain',
    ).toBeTruthy();
  });

  it('un utilisateur sans parrainage se supprime toujours (non-régression)', async () => {
    const id = await registerUser();

    await expect(users.deleteMe(id, undefined)).resolves.toBeUndefined();

    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
  });
});
