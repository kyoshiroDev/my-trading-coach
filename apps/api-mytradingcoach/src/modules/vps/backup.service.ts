import { Injectable } from '@nestjs/common';
import { VpsService } from './vps.service';

export interface Backup {
  filename: string;
  size: number;
  createdAt: string;
  type: 'auto' | 'manual';
}

@Injectable()
export class BackupService {
  private readonly backupDir = process.env['BACKUP_DIR'] ?? '/opt/backups/mtc';
  private readonly dbName = process.env['POSTGRES_DB'] ?? 'mytradingcoach_prod';
  private readonly dbUser = process.env['POSTGRES_USER'] ?? 'mtc_user';

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
        const size = parseInt(parts[4] || '0');
        const filename = parts[parts.length - 1].split('/').pop() ?? '';
        const dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
        return {
          filename,
          size,
          createdAt: new Date(dateStr).toISOString(),
          type: filename.includes('_manual_') ? 'manual' : 'auto',
        } as Backup;
      })
      .filter(b => b.filename);
  }

  async createBackup(): Promise<Backup> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
    const filename = `mtc_prod_${timestamp}_manual.sql.gz`;
    const cmd = `docker exec mtc_postgres pg_dump -U ${this.dbUser} ${this.dbName} | gzip > ${this.backupDir}/${filename}`;
    await this.vps.exec(cmd);
    return {
      filename,
      size: 0,
      createdAt: new Date().toISOString(),
      type: 'manual',
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
