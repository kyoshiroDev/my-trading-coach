import { BadRequestException, Injectable } from '@nestjs/common';
import { VpsService } from './vps.service';

export type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev';

export interface Backup {
  filename: string;
  sizeMb: number;
  createdAt: string;
  type: 'auto' | 'manual';
  target: BackupTarget;
}

/** Bases gérées pour le backup manuel à la demande (dumps SQL dans BACKUP_DIR). */
const DB_BY_TARGET: Record<'bdd_prod' | 'bdd_dev', string> = {
  bdd_prod: 'mytradingcoach_prod',
  bdd_dev: 'mytradingcoach_dev',
};

const toMb = (bytes: number): number =>
  Math.round((bytes / (1024 * 1024)) * 10) / 10;

@Injectable()
export class BackupService {
  private readonly backupDir = process.env['BACKUP_DIR'] ?? '/opt/backups/mtc';

  constructor(private readonly vps: VpsService) {}

  async listBackups(): Promise<Backup[]> {
    const output = await this.vps.exec(
      `ls -la ${this.backupDir}/*.sql.gz 2>/dev/null || echo ""`,
    );
    if (!output.trim()) return [];
    return output.split('\n')
      .filter(l => l.trim() && l.includes('.sql.gz'))
      .map(line => {
        const parts = line.trim().split(/\s+/);
        const size = parseInt(parts[4] || '0', 10);
        const filename = parts[parts.length - 1].split('/').pop() ?? '';
        const dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
        return {
          filename,
          sizeMb: toMb(size),
          createdAt: new Date(dateStr).toISOString(),
          type: filename.includes('_manual') ? 'manual' : 'auto',
          target: filename.includes('_dev_') ? 'bdd_dev' : 'bdd_prod',
        } as Backup;
      })
      .filter(b => b.filename);
  }

  async createBackup(target: BackupTarget = 'bdd_prod'): Promise<Backup> {
    const db = DB_BY_TARGET[target as 'bdd_prod' | 'bdd_dev'];
    if (!db) {
      throw new BadRequestException(
        `Backup manuel non géré pour « ${target} » — seules les bases bdd_prod / bdd_dev sont sauvegardables ici (les images/configs API passent par backup-apps.sh).`,
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const label = target === 'bdd_dev' ? 'dev' : 'prod';
    const filename = `mtc_${label}_${timestamp}_manual.sql.gz`;
    const path = `${this.backupDir}/${filename}`;

    // Dump puis lecture de la taille réelle du fichier produit, en une seule commande.
    const out = await this.vps.exec(
      `docker exec mtc_postgres pg_dump -U mtc_user ${db} | gzip > ${path} && stat -c %s ${path}`,
    );
    const size = parseInt(out.trim() || '0', 10);

    return {
      filename,
      sizeMb: toMb(size),
      createdAt: new Date().toISOString(),
      type: 'manual',
      target,
    };
  }

  async deleteBackup(filename: string): Promise<void> {
    // Sanitize filename — allow only safe chars
    if (!/^[\w\-.]+\.sql\.gz$/.test(filename)) {
      throw new Error('Nom de fichier invalide');
    }
    await this.vps.exec(`rm -f ${this.backupDir}/${filename}`);
  }
}
