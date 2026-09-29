import { IsIn, IsOptional } from 'class-validator';
import type { BackupTarget } from '../backup.service';

const BACKUP_TARGETS: BackupTarget[] = ['bdd_prod', 'bdd_dev', 'bdd_beta', 'api_prod', 'api_dev'];

export class CreateBackupDto {
  @IsOptional()
  @IsIn(BACKUP_TARGETS)
  target?: BackupTarget;
}
