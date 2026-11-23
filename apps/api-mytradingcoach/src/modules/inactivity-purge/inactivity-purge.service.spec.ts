import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { INACTIVITY_MAX_DELETIONS, INACTIVITY_MAX_NOTICES, InactivityPurgeService } from './inactivity-purge.service';
import { INACTIVITY_NOTICE_CAMPAIGN } from './inactivity-purge.util';
import { freezeClock } from '../../test/freeze-clock';

// Dates fixes : horloge figée au 09/01/2026, 10 h Paris (règle du dépôt), et passée en argument à `run`.
const NOW = new Date('2026-01-09T09:00:00Z');
const at = (day: string) => new Date(`${day}T09:00:00Z`);
// Dernière connexion le 10/01/2024 → J = 09/01/2026 : préavis le 12/12, 19/12, 26/12 et 02/01.
const user = (id: string, notices: string[] = []) => ({
  id, email: `${id}@exemple.test`, name: 'Trader Test', lastSeenAt: new Date('2024-01-10T14:00:00Z'), lastLoginAt: null,
  createdAt: new Date('2023-01-01T00:00:00Z'), emailSends: notices.map((d) => ({ sentAt: at(d) })),
});
const ALL_NOTICES = ['2025-12-12', '2025-12-19', '2025-12-26', '2026-01-02'];

function setup(rows: ReturnType<typeof user>[], enabled: boolean) {
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue(rows), count: vi.fn().mockResolvedValue(2) },
    emailSend: { create: vi.fn().mockResolvedValue({}) },
  };
  const users = { deleteForInactivity: vi.fn().mockResolvedValue(undefined) };
  const resend = { sendInactivityNotice: vi.fn().mockResolvedValue(undefined) };
  const config = { get: vi.fn((k: string) => (k === 'INACTIVITY_PURGE_ENABLED' ? String(enabled) : undefined)) };
  const svc = new InactivityPurgeService(prisma as never, users as never, resend as never, config as never);
  return { svc, prisma, users, resend };
}

describe('InactivityPurgeService (#824)', () => {
  freezeClock(NOW);
  afterEach(() => vi.restoreAllMocks());

  it('journal seul (variable absente ou false) : rien écrit, envoyé ni supprimé, seulement des comptes', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { svc, prisma, users, resend } = setup([user('u_notice', ['2025-12-12', '2025-12-19', '2025-12-26']), user('u_delete', ALL_NOTICES)], false);
    const r = await svc.run(at('2026-01-09'));
    expect(r).toMatchObject({ enabled: false, notices: [0, 0, 0, 1], deletions: 1 }); // 4ᵉ préavis dû, suppression due
    expect(resend.sendInactivityNotice).not.toHaveBeenCalled();
    expect(prisma.emailSend.create).not.toHaveBeenCalled();
    expect(users.deleteForInactivity).not.toHaveBeenCalled();
    expect(r.excluded).toEqual({ demo: 2, admin: 2, abonnement: 2, periodePayee: 2, essai: 2, fondateur: 2, commission: 2 });
    // Le journal ne contient que des comptes : aucune adresse e-mail.
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toContain('(journal seul)');
    expect(line).not.toContain('@');
  });

  it('journal seul : préavis dus comptés par rang', async () => {
    const { svc } = setup([user('a', ['2025-12-12', '2025-12-19', '2025-12-26'])], false);
    expect((await svc.run(at('2026-01-02'))).notices).toEqual([0, 0, 0, 1]);
  });

  it('actif : préavis envoyé avec la date plancher, puis enregistré (transactionnel, clé unique)', async () => {
    const { svc, prisma, resend } = setup([user('a')], true);
    const r = await svc.run(at('2025-12-12'));
    expect(r.notices).toEqual([1, 0, 0, 0]);
    expect(resend.sendInactivityNotice).toHaveBeenCalledWith({ to: 'a@exemple.test', userName: 'Trader Test', deletionDay: '2026-01-09', last: false });
    expect(prisma.emailSend.create).toHaveBeenCalledWith({
      data: { campaignKey: INACTIVITY_NOTICE_CAMPAIGN, userId: 'a', kind: 'transactional', sentAt: at('2025-12-12') },
    });
  });

  it('actif : 4ᵉ préavis = dernier rappel', async () => {
    const { svc, resend } = setup([user('a', ALL_NOTICES.slice(0, 3))], true);
    await svc.run(at('2026-01-02'));
    expect(resend.sendInactivityNotice).toHaveBeenCalledWith(expect.objectContaining({ last: true, deletionDay: '2026-01-09' }));
  });

  it('une connexion après les préavis remet le cycle à zéro (anciens préavis ignorés)', async () => {
    const u = { ...user('a', ALL_NOTICES), lastSeenAt: new Date('2026-01-05T08:00:00Z') };
    const { svc, users, resend } = setup([u], true);
    expect(await svc.run(at('2026-01-09'))).toMatchObject({ notices: [0, 0, 0, 0], deletions: 0 });
    expect(users.deleteForInactivity).not.toHaveBeenCalled();
    expect(resend.sendInactivityNotice).not.toHaveBeenCalled();
  });

  it('actif : suppression à la date annoncée, par le chemin des suppressions', async () => {
    const { svc, users } = setup([user('a', ALL_NOTICES)], true);
    expect((await svc.run(NOW)).deletions).toBe(1);
    expect(users.deleteForInactivity).toHaveBeenCalledWith('a');
  });

  it('connexion pendant le passage : relue juste avant la suppression, compte gardé', async () => {
    const { svc, prisma, users } = setup([user('a', ALL_NOTICES)], true);
    prisma.user.count.mockResolvedValue(0);
    expect((await svc.run(NOW)).deletions).toBe(0);
    expect(users.deleteForInactivity).not.toHaveBeenCalled();
    expect(prisma.user.count.mock.calls[0][0].where.AND[1]).toEqual({ id: 'a' });
  });

  it('échec Stripe sur un compte : compté, le passage continue, aucune adresse dans le journal', async () => {
    const err = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { svc, users } = setup([user('a', ALL_NOTICES), user('b', ALL_NOTICES)], true);
    users.deleteForInactivity.mockRejectedValueOnce(new ServiceUnavailableException('Stripe pour a@exemple.test'));
    expect(await svc.run(NOW)).toMatchObject({ deletions: 1, failures: 1 });
    expect(users.deleteForInactivity).toHaveBeenCalledTimes(2);
    const lines = err.mock.calls.map((c) => String(c[0])).join('\n');
    expect(lines).toContain('Purge du compte a reportée : ServiceUnavailableException');
    expect(lines).not.toContain('@');
  });

  it('échec d’envoi d’un préavis : rien enregistré, il repart au prochain passage', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { svc, prisma, resend } = setup([user('a'), user('b')], true);
    resend.sendInactivityNotice.mockRejectedValueOnce(new Error('Resend'));
    expect(await svc.run(at('2025-12-12'))).toMatchObject({ notices: [1, 0, 0, 0], failures: 1 });
    expect(prisma.emailSend.create).toHaveBeenCalledTimes(1);
  });

  it('plafonds par passage : 50 suppressions et 500 préavis, le reste reporté', async () => {
    const del = Array.from({ length: INACTIVITY_MAX_DELETIONS + 3 }, (_, i) => user(`d${i}`, ALL_NOTICES));
    const a = setup(del, true);
    expect(await a.svc.run(NOW)).toMatchObject({ deletions: INACTIVITY_MAX_DELETIONS, deferred: 3 });
    const notices = Array.from({ length: INACTIVITY_MAX_NOTICES + 2 }, (_, i) => user(`n${i}`));
    const b = setup(notices, true);
    expect(await b.svc.run(at('2025-12-12'))).toMatchObject({ notices: [INACTIVITY_MAX_NOTICES, 0, 0, 0], deferred: 2 });
  });
});
