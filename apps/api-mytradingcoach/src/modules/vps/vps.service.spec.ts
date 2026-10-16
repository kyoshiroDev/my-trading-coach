import { BadGatewayException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpectedOutageException } from '../../common/exceptions/expected-outage.exception';
import type { RedisService } from '../infra/redis.service';

const ssh = vi.hoisted(() => ({
  connect: vi.fn(),
  execCommand: vi.fn(),
  connected: false,
}));
vi.mock('node-ssh', () => ({
  NodeSSH: class {
    async connect(cfg: unknown) {
      await ssh.connect(cfg);
      ssh.connected = true;
    }
    isConnected() { return ssh.connected; }
    execCommand(cmd: string) { return ssh.execCommand(cmd); }
    dispose() { ssh.connected = false; }
  },
}));
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('@sentry/nestjs', () => sentry);

import { VPS_RETRY_DELAY_MS, VpsService, describeSshError, hostKeyFingerprint } from './vps.service';

const ENV = {
  VPS_HOST: '149.202.40.240',
  VPS_SSH_KEY_B64: 'cHJpbmNpcGFs',
  VPS_SECONDARY_HOST: '51.83.197.230',
  VPS_SECONDARY_LABEL: 'VPS dev · beta',
  VPS_SECONDARY_SSH_KEY_B64: 'c2Vjb25kYWlyZQ==',
};

const authFailure = () => Object.assign(new Error('All configured authentication methods failed'), { level: 'client-authentication' });

/** Redis en mémoire : juste SET NX EX et DEL. */
function fakeRedis() {
  const store = new Map<string, string>();
  const client = {
    set: vi.fn(async (k: string, v: string, _ex: string, _ttl: number, nx: string) => {
      if (nx === 'NX' && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
  return { client } as unknown as RedisService;
}

describe('VpsService · indisponibilité du serveur', () => {
  let redis: RedisService;
  const service = () => new VpsService(redis);

  beforeEach(() => {
    vi.useFakeTimers();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    redis = fakeRedis();
    ssh.connected = false;
    ssh.connect.mockReset();
    ssh.execCommand.mockReset();
    sentry.captureMessage.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('connexion refusée → 503 VPS_UNREACHABLE avec la raison, sans retentative pendant 60 s', async () => {
    ssh.connect.mockRejectedValue(authFailure());
    const vps = service();

    const err = await vps.getConnection('secondaire').catch((e) => e);
    expect(err).toBeInstanceOf(ExpectedOutageException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual({
      code: 'VPS_UNREACHABLE',
      message: 'VPS dev · beta injoignable en SSH (authentification refusée). Nouvel essai dans 60 s.',
    });

    vi.advanceTimersByTime(30_000);
    await expect(vps.getConnection('secondaire')).rejects.toThrow('Nouvel essai dans 30 s');
    expect(ssh.connect).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(VPS_RETRY_DELAY_MS);
    await expect(vps.getConnection('secondaire')).rejects.toBeInstanceOf(ExpectedOutageException);
    expect(ssh.connect).toHaveBeenCalledTimes(2);
  });

  it('requêtes simultanées : une seule tentative SSH', async () => {
    ssh.connect.mockRejectedValue(authFailure());
    const vps = service();
    const results = await Promise.allSettled([vps.getConnection('secondaire'), vps.getConnection('secondaire')]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(ssh.connect).toHaveBeenCalledTimes(1);
  });

  it('une seule alerte Sentry (warning) par panne, même entre plusieurs process', async () => {
    ssh.connect.mockRejectedValue(authFailure());
    const a = service();
    const b = service(); // autre process, même Redis
    for (let i = 0; i < 3; i++) {
      await a.getConnection('secondaire').catch(() => undefined);
      await b.getConnection('secondaire').catch(() => undefined);
      vi.advanceTimersByTime(VPS_RETRY_DELAY_MS);
    }
    expect(ssh.connect).toHaveBeenCalledTimes(6);
    expect(sentry.captureMessage).toHaveBeenCalledOnce();
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'VPS injoignable en SSH : VPS dev · beta',
      expect.objectContaining({ level: 'warning', tags: { vps: 'secondaire' } }),
    );
  });

  it('retour puis nouvelle panne → nouvelle alerte', async () => {
    const vps = service();
    ssh.connect.mockRejectedValueOnce(authFailure());
    await vps.getConnection('secondaire').catch(() => undefined);
    vi.advanceTimersByTime(VPS_RETRY_DELAY_MS);

    ssh.connect.mockResolvedValueOnce(undefined);
    await vps.getConnection('secondaire');
    ssh.connected = false; // connexion perdue

    ssh.connect.mockRejectedValueOnce(authFailure());
    await vps.getConnection('secondaire').catch(() => undefined);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(2);
  });

  it('Redis indisponible : décision locale, toujours une seule alerte', async () => {
    redis = { client: { set: vi.fn().mockRejectedValue(new Error('down')), del: vi.fn().mockRejectedValue(new Error('down')) } } as unknown as RedisService;
    ssh.connect.mockRejectedValue(authFailure());
    const vps = service();
    await vps.getConnection('secondaire').catch(() => undefined);
    vi.advanceTimersByTime(VPS_RETRY_DELAY_MS);
    await vps.getConnection('secondaire').catch(() => undefined);
    expect(sentry.captureMessage).toHaveBeenCalledOnce();
  });

  it('principal sans clé : erreur de configuration (lue par le cron de santé), pas de connexion', async () => {
    vi.stubEnv('VPS_SSH_KEY_B64', '');
    await expect(service().getConnection('principal')).rejects.toThrow('VPS_SSH_KEY_B64 non configurée');
    expect(ssh.connect).not.toHaveBeenCalled();
  });

  it('connexion avec la clé et l’utilisateur du secondaire, clé d’hôte vérifiée si configurée', async () => {
    vi.stubEnv('VPS_SECONDARY_HOST_KEY_SHA256', hostKeyFingerprint(Buffer.from('cle-hote')));
    ssh.connect.mockResolvedValue(undefined);
    await service().getConnection('secondaire');
    const cfg = ssh.connect.mock.calls[0][0];
    expect(cfg).toMatchObject({ host: '51.83.197.230', username: 'mtc-monitor', privateKey: 'secondaire', readyTimeout: 10_000 });
    expect(cfg.hostVerifier(Buffer.from('cle-hote'))).toBe(true);
    expect(cfg.hostVerifier(Buffer.from('autre-cle'))).toBe(false);
  });
});

describe('VpsService · exec', () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    ssh.connected = true;
  });
  afterEach(() => vi.unstubAllEnvs());

  const vps = () => new VpsService({ client: {} } as unknown as RedisService);

  it('code de sortie 0 → stdout', async () => {
    ssh.execCommand.mockResolvedValue({ stdout: 'ok', stderr: '', code: 0, signal: null });
    await expect(vps().exec('docker restart x')).resolves.toBe('ok');
  });

  it('code de sortie non nul → 502 VPS_COMMAND_FAILED, jamais « succès »', async () => {
    ssh.execCommand.mockResolvedValue({ stdout: '', stderr: 'mtc-monitor : commande refusée\n', code: 126, signal: null });
    const err = await vps().exec('docker restart x', 'secondaire').catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.getResponse()).toEqual({
      code: 'VPS_COMMAND_FAILED',
      message: 'Commande en échec sur VPS dev · beta (code 126) : mtc-monitor : commande refusée',
    });
  });
});

describe('describeSshError', () => {
  it.each([
    [authFailure(), 'authentification refusée'],
    [new Error('Host denied (verification failed)'), "clé d'hôte inattendue"],
    [Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'connexion refusée'],
    [new Error('Timed out while waiting for handshake'), 'délai dépassé'],
    [Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }), 'hôte injoignable'],
    [Object.assign(new Error('x'), { code: 'ENOTFOUND' }), 'hôte introuvable'],
    [new Error('autre'), 'erreur SSH'],
  ])('%s → %s', (e, expected) => {
    expect(describeSshError(e)).toBe(expected);
  });
});
