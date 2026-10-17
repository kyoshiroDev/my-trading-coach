import { BadRequestException, Injectable } from '@nestjs/common';
import { VpsService } from './vps.service';

export type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'bdd_beta' | 'api_prod' | 'api_dev';

export interface Backup {
  filename: string;
  sizeMb: number;
  createdAt: string;
  type: 'auto' | 'manual';
  target: BackupTarget;
}

type DbTarget = 'bdd_prod' | 'bdd_dev' | 'bdd_beta';

/** Bases gérées pour le backup manuel à la demande (dumps SQL dans BACKUP_DIR). */
const DB_BY_TARGET: Record<DbTarget, string> = {
  bdd_prod: 'mytradingcoach_prod',
  bdd_dev: 'mytradingcoach_dev',
  bdd_beta: 'mytradingcoach_beta',
};

/** Libellé présent dans le nom de fichier `mtc_<label>_<ts>_<type>.sql.gz`. */
const LABEL_BY_TARGET: Record<DbTarget, string> = {
  bdd_prod: 'prod',
  bdd_dev: 'dev',
  bdd_beta: 'beta',
};

/**
 * Déduit l'environnement depuis le nom de fichier. L'ordre compte : `prod` est
 * le défaut historique, donc on teste d'abord les libellés explicites.
 */
const targetFromFilename = (filename: string): DbTarget => {
  if (filename.includes('_dev_')) return 'bdd_dev';
  if (filename.includes('_beta_')) return 'bdd_beta';
  return 'bdd_prod';
};

const toMb = (bytes: number): number =>
  Math.round((bytes / (1024 * 1024)) * 10) / 10;

/**
 * Une ligne de `ls -l --time-style=+%s` : droits, liens, user, groupe, taille, mtime (secondes
 * epoch), chemin. La date vient de l'epoch, indépendante du fuseau. Avant, le format court de
 * `ls -la` (« Oct 17 03:00 », sans année) passait par `new Date()`, qui complétait l'année en 2001 :
 * le bandeau « dernière sauvegarde » de l'admin alertait en permanence.
 */
export function parseBackupLine(line: string): Backup | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 7) return null;
  const size = parseInt(parts[4], 10);
  const epoch = Number(parts[5]);
  const filename = parts[parts.length - 1].split('/').pop() ?? '';
  if (!filename.endsWith('.sql.gz') || !Number.isInteger(epoch) || epoch <= 0) return null;
  return {
    filename,
    sizeMb: toMb(Number.isNaN(size) ? 0 : size),
    createdAt: new Date(epoch * 1000).toISOString(),
    type: filename.includes('_manual') ? 'manual' : 'auto',
    target: targetFromFilename(filename),
  };
}

@Injectable()
export class BackupService {
  private readonly backupDir = process.env['BACKUP_DIR'] ?? '/opt/backups/mtc';

  constructor(private readonly vps: VpsService) {}

  async listBackups(): Promise<Backup[]> {
    const output = await this.vps.exec(
      `ls -l --time-style=+%s ${this.backupDir}/*.sql.gz 2>/dev/null || echo ""`,
    );
    if (!output.trim()) return [];
    return output.split('\n')
      .map(parseBackupLine)
      .filter((b): b is Backup => b !== null);
  }

  async createBackup(target: BackupTarget = 'bdd_prod'): Promise<Backup> {
    const db = DB_BY_TARGET[target as DbTarget];
    if (!db) {
      throw new BadRequestException(
        `Backup manuel non géré pour « ${target} » : seules les bases bdd_prod / bdd_dev / bdd_beta sont sauvegardables ici (les images/configs API passent par backup-apps.sh).`,
      );
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const label = LABEL_BY_TARGET[target as DbTarget];
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
    // Sanitize filename : allow only safe chars
    if (!/^[\w\-.]+\.sql\.gz$/.test(filename)) {
      throw new Error('Nom de fichier invalide');
    }
    await this.vps.exec(`rm -f ${this.backupDir}/${filename}`);
  }
}
