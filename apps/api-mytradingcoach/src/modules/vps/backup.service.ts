import { Injectable, BadRequestException } from '@nestjs/common';
import { VpsService } from './vps.service';

export interface Backup {
  filename: string;
  sizeMb: number;
  createdAt: string;
  type: 'auto' | 'manual';
  target: 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev';
}

type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev';

@Injectable()
export class BackupService {
  private readonly dir    = process.env['BACKUP_DIR']      ?? '/opt/backups/mtc';
  private readonly dbName = process.env['POSTGRES_DB']     ?? 'mytradingcoach_prod';
  private readonly dbUser = process.env['POSTGRES_USER']   ?? 'mtc_user';
  private readonly dbDev  = process.env['POSTGRES_DB_DEV'] ?? 'mytradingcoach_dev';
  private readonly appDir = process.env['APP_DIR']         ?? '/opt/apps/mytradingcoach/prod';

  constructor(private readonly vps: VpsService) {}

  async listBackups(): Promise<{ data: Backup[] }> {
    const output = await this.vps.exec(
      `find ${this.dir} \\( -name "*.sql.gz" -o -name "*.tar.gz" \\) 2>/dev/null | ` +
      `xargs -I{} stat --format="%n|%s|%Y" {} 2>/dev/null | sort -t'|' -k3 -r || echo ""`,
    );

    if (!output.trim()) return { data: [] };

    const backups = output.split('\n')
      .filter(l => l.includes('|'))
      .map(line => {
        const [fullpath, sizeStr, epochStr] = line.split('|');
        const filename = fullpath?.split('/').pop() ?? '';
        if (!filename) return null;
        const sizeMb    = parseFloat((parseInt(sizeStr ?? '0') / 1024 / 1024).toFixed(1));
        const epoch     = parseInt(epochStr ?? '0') * 1000;
        const createdAt = new Date(epoch).toISOString();
        const type      = filename.includes('_manual') ? 'manual' : 'auto';
        const target    = this.detectTarget(filename);
        return { filename, sizeMb, createdAt, type, target } as Backup;
      })
      .filter(Boolean) as Backup[];

    return { data: backups };
  }

  private detectTarget(filename: string): BackupTarget {
    if (filename.includes('api_prod')) return 'api_prod';
    if (filename.includes('api_dev'))  return 'api_dev';
    if (filename.includes('_dev_'))    return 'bdd_dev';
    return 'bdd_prod';
  }

  async createBackup(target: BackupTarget = 'bdd_prod'): Promise<{ data: Backup }> {
    const ts = new Date().toISOString()
      .replace('T', '_').replace(/:/g, '').slice(0, 15);

    let filename: string;
    let cmd: string;

    switch (target) {
      case 'bdd_prod':
        filename = `mtc_prod_${ts}_manual.sql.gz`;
        cmd = `docker exec mtc_postgres pg_dump -U ${this.dbUser} ${this.dbName} | gzip > ${this.dir}/${filename}`;
        break;
      case 'bdd_dev':
        filename = `mtc_dev_${ts}_manual.sql.gz`;
        cmd = `docker exec mtc_postgres pg_dump -U ${this.dbUser} ${this.dbDev} | gzip > ${this.dir}/${filename}`;
        break;
      case 'api_prod':
        filename = `mtc_api_prod_${ts}_manual.tar.gz`;
        cmd = `tar -czf ${this.dir}/${filename} -C ${this.appDir} docker-compose.prod.yml 2>/dev/null || true`;
        break;
      case 'api_dev':
        filename = `mtc_api_dev_${ts}_manual.tar.gz`;
        cmd = `tar -czf ${this.dir}/${filename} -C ${this.appDir} docker-compose.dev.yml 2>/dev/null || true`;
        break;
      default:
        throw new BadRequestException('Cible invalide');
    }

    await this.vps.exec(cmd);
    return {
      data: {
        filename,
        sizeMb: 0,
        createdAt: new Date().toISOString(),
        type: 'manual',
        target,
      },
    };
  }

  async restoreBackup(filename: string): Promise<{ success: boolean; message: string }> {
    if (!/^[\w\-\.]+\.(sql\.gz|tar\.gz)$/.test(filename)) {
      throw new BadRequestException('Nom de fichier invalide');
    }
    const filepath = `${this.dir}/${filename}`;
    const target   = this.detectTarget(filename);
    let cmd: string;

    switch (target) {
      case 'bdd_prod':
        cmd = `gunzip -c ${filepath} | docker exec -i mtc_postgres psql -U ${this.dbUser} ${this.dbName}`;
        break;
      case 'bdd_dev':
        cmd = `gunzip -c ${filepath} | docker exec -i mtc_postgres psql -U ${this.dbUser} ${this.dbDev}`;
        break;
      case 'api_prod':
      case 'api_dev':
        cmd = `tar -xzf ${filepath} -C ${this.appDir}`;
        break;
      default:
        throw new BadRequestException('Cible non restaurable');
    }

    await this.vps.exec(cmd);
    return { success: true, message: `Backup "${filename}" restauré avec succès` };
  }

  async deleteBackup(filename: string): Promise<void> {
    if (!/^[\w\-\.]+\.(sql\.gz|tar\.gz)$/.test(filename)) {
      throw new BadRequestException('Nom de fichier invalide');
    }
    await this.vps.exec(`rm -f ${this.dir}/${filename}`);
  }
}
