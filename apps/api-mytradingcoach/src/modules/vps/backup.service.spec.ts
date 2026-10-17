import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackupService, parseBackupLine } from './backup.service';
import type { VpsService } from './vps.service';

// Sauvegarde de nuit du 17/10/2026 à 03:00:03 (Paris, CEST) = 01:00:03 UTC.
const LINE_17_10 = '-rw-rw-r-- 1 greg greg 7034277 1792198803 /opt/backups/mtc/mtc_prod_20261017T0300_auto.sql.gz';

describe('parseBackupLine', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('mtc_prod_20261017T0300_auto.sql.gz → 17/10/2026 03:00 à Paris, année 2026', () => {
    const b = parseBackupLine(LINE_17_10);
    expect(b).toEqual({
      filename: 'mtc_prod_20261017T0300_auto.sql.gz',
      sizeMb: 6.7,
      createdAt: '2026-10-17T01:00:03.000Z',
      type: 'auto',
      target: 'bdd_prod',
    });
    expect(new Date(b!.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })).toBe('17/10/2026 03:00:03');
  });

  it.each(['UTC', 'Europe/Paris', 'America/New_York', 'Asia/Tokyo'])(
    'même instant quel que soit le fuseau du process de l’API (TZ=%s)',
    (tz) => {
      vi.stubEnv('TZ', tz);
      expect(parseBackupLine(LINE_17_10)?.createdAt).toBe('2026-10-17T01:00:03.000Z');
    },
  );

  it('ancien format court de ls -la (« Oct 17 03:00 », sans année) : ignoré, jamais l’année 2001', () => {
    expect(parseBackupLine('-rw-rw-r-- 1 greg greg 7034277 Oct 17 03:00 /opt/backups/mtc/mtc_prod_20261017T0300_auto.sql.gz')).toBeNull();
  });

  it('sauvegarde manuelle de dev', () => {
    expect(parseBackupLine('-rw-rw-r-- 1 greg greg 300000 1792170000 /opt/backups/mtc/mtc_dev_20261016T1920_manual.sql.gz'))
      .toMatchObject({ type: 'manual', target: 'bdd_dev' });
  });

  it('ligne vide ou autre fichier : ignorée', () => {
    expect(parseBackupLine('')).toBeNull();
    expect(parseBackupLine('-rw-rw-r-- 1 greg greg 10 1792198803 /opt/backups/mtc/backup.sh')).toBeNull();
  });
});

describe('BackupService.listBackups', () => {
  it('lit la date en secondes epoch (ls --time-style=+%s)', async () => {
    const exec = vi.fn().mockResolvedValue(`${LINE_17_10}\n`);
    const backups = await new BackupService({ exec } as unknown as VpsService).listBackups();
    expect(exec.mock.calls[0][0]).toContain('ls -l --time-style=+%s ');
    expect(backups).toHaveLength(1);
    expect(new Date(backups[0].createdAt).getUTCFullYear()).toBe(2026);
  });
});
