import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { BackupService } from './backup.service';
import { DockerService } from './docker.service';
import { VpsController } from './vps.controller';
import type { VpsService } from './vps.service';
import { VPS_READ_COMMANDS } from './vps-commands';

const SSH_DIR = join(__dirname, '../../../../../infra/prod/ssh');
const SCRIPT = join(SSH_DIR, 'mtc-api-admin.sh');
const ALLOWED_FILE = join(SSH_DIR, 'mtc-api-admin-allowed-commands');

/** Lectures déjà déployées sur main, encore acceptées tant que main ne les a pas remplacées. */
const LEGACY_READS = ['ls -la /opt/backups/mtc/*.sql.gz 2>/dev/null || echo ""'];

/** Verdict du script en mode --check (rien n'est exécuté) : « OK… » ou « REFUS (…) ». */
function check(cmd: string): string {
  try {
    return execFileSync('bash', [SCRIPT, '--check'], {
      env: { PATH: process.env['PATH'], SSH_ORIGINAL_COMMAND: cmd, MTC_API_ADMIN_ALLOWED: ALLOWED_FILE },
      encoding: 'utf8',
    }).trim();
  } catch (e) {
    return String((e as { stdout?: string }).stdout ?? '').trim();
  }
}

/** Commandes réellement envoyées par les services, capturées sur un faux VpsService. */
function fakeVps() {
  const sent: string[] = [];
  const vps = {
    exec: vi.fn(async (cmd: string) => {
      sent.push(cmd);
      return '123';
    }),
    getConnection: vi.fn(async () => ({
      exec: vi.fn(async (cmd: string) => {
        sent.push(cmd);
      }),
    })),
  } as unknown as VpsService;
  return { vps, sent };
}

describe('filtre SSH de la clé de l’API (infra/prod/ssh/mtc-api-admin.sh)', () => {
  beforeEach(() => {
    vi.stubEnv('BACKUP_DIR', '/opt/backups/mtc');
    vi.stubEnv('VPS_SECONDARY_HOST', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('la liste blanche contient toutes les lectures de la page Surveillance et des sauvegardes', async () => {
    const { vps, sent } = fakeVps();
    await new BackupService(vps).listBackups();
    const lines = readFileSync(ALLOWED_FILE, 'utf8').split('\n').filter(Boolean);
    for (const cmd of [...Object.values(VPS_READ_COMMANDS), ...sent]) expect(lines).toContain(cmd);
    // Rien d'autre que ces lectures (et celles encore sur main).
    const known = new Set<string>([...Object.values(VPS_READ_COMMANDS), ...sent, ...LEGACY_READS]);
    for (const line of lines) expect(known.has(line)).toBe(true);
  });

  it('accepte chaque commande envoyée par l’API', async () => {
    const { vps, sent } = fakeVps();
    const docker = new DockerService(vps);
    const backup = new BackupService(vps);
    await docker.containerAction('mtc_api_prod_blue', 'start');
    await docker.containerAction('mtc_api_prod_blue', 'stop');
    await docker.containerAction('mtc_api_prod_blue', 'restart');
    await backup.listBackups();
    await backup.createBackup('bdd_prod');
    await backup.deleteBackup('mtc_prod_20261017T0300_auto.sql.gz');
    const res = { setHeader: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn() };
    const req = { on: vi.fn() };
    await new VpsController(vps, docker, backup).streamLogs(
      'mtc_api_prod_blue', req as unknown as Request, res as unknown as Response,
    );

    expect(sent).toHaveLength(7);
    for (const cmd of [...Object.values(VPS_READ_COMMANDS), ...LEGACY_READS, ...sent]) {
      expect(check(cmd), cmd).toMatch(/^OK/);
    }
  });

  it('refuse le reste', () => {
    for (const cmd of [
      '',
      'docker rm -f mtc_redis',
      'docker logs -f --tail 100 --help',
      'docker logs -f --tail 100 -x',
      'docker logs -f --tail 100 ',
      'docker restart -t0',
      'cat /proc/loadavg\nid',
      'cat /proc/loadavg\rid',
      'cat /proc/loadavg; id',
      'rm -f /opt/backups/mtc/../x.sql.gz',
      'rm -f /opt/backups/mtc/x.sql.gz /etc/passwd',
      'docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_dev | gzip > /opt/backups/mtc/mtc_dev_2026-10-17T1200_manual.sql.gz && stat -c %s /opt/backups/mtc/mtc_dev_2026-10-17T1200_manual.sql.gz',
      'docker exec mtc_postgres pg_dump -U mtc_user mytradingcoach_prod | gzip > /opt/backups/mtc/mtc_prod_2026-10-17T1200_manual.sql.gz && stat -c %s /opt/backups/mtc/mtc_prod_2026-10-17T1201_manual.sql.gz',
      'bash',
    ]) {
      expect(check(cmd), JSON.stringify(cmd)).toMatch(/^REFUS/);
    }
  });
});
