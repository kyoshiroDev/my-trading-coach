import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, inject, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideDynamicIcon,
  LucideRefreshCw as RefreshCw,
  LucidePlus as Plus,
  LucideTrash2 as Trash2,
  LucideRotateCcw as RotateCcw,
  LucideX as X,
  LucideAlertTriangle as AlertTriangle,
} from '@lucide/angular';
import { VpsApi, Backup } from '../../core/api/vps.api';
import { DialogDirective } from '@mtc/front-ui';

type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'bdd_beta' | 'api_prod' | 'api_dev';

const TARGET_CONFIG: Record<BackupTarget, { label: string; color: string; icon: string; desc: string }> = {
  bdd_prod: { label: 'BDD Production', color: '#00d4aa', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_prod' },
  bdd_dev:  { label: 'BDD Dev',        color: '#4a9eff', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_dev' },
  bdd_beta: { label: 'BDD Beta',       color: '#e879f9', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_beta' },
  api_prod: { label: 'Config API Prod',color: '#f5a623', icon: '📦', desc: 'docker-compose.prod.yml' },
  api_dev:  { label: 'Config API Dev', color: '#8b5cf6', icon: '📦', desc: 'docker-compose.dev.yml' },
};

@Component({
  selector: 'mtc-admin-backups',
  imports: [DialogDirective, DatePipe, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './backups.component.css',
  templateUrl: './backups.component.html',
})
export class BackupsComponent {
  private readonly vpsApi = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly RefreshIcon = RefreshCw;
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;
  protected readonly RestoreIcon = RotateCcw;
  protected readonly XIcon = X;
  protected readonly AlertIcon = AlertTriangle;

  /** Seuil au-delà duquel on alerte que la dernière sauvegarde est trop ancienne. */
  protected readonly staleThresholdH = 48;

  protected readonly loading = signal(true);
  protected readonly backups = signal<Backup[]>([]);
  protected readonly backingUp = signal<BackupTarget | null>(null);
  protected readonly restoring = signal<string | null>(null);
  protected readonly showModal = signal(false);
  protected readonly selectedTarget = signal<BackupTarget | null>(null);
  protected readonly restoreTarget = signal<Backup | null>(null);
  protected readonly deleteTarget = signal<Backup | null>(null);
  protected readonly restoreConfirmInput = signal('');

  protected readonly targetEntries = Object.entries(TARGET_CONFIG).map(([key, val]) => ({ key: key as BackupTarget, ...val }));

  protected readonly autoCount = computed(() => this.backups().filter((b) => b.type === 'auto').length);
  protected readonly manualCount = computed(() => this.backups().filter((b) => b.type === 'manual').length);
  protected readonly totalSizeMb = computed(() => this.backups().reduce((s, b) => s + (b.sizeMb ?? 0), 0).toFixed(1));

  protected readonly prodBackups = computed(() => this.byEnv('prod'));
  protected readonly devBackups = computed(() => this.byEnv('dev'));

  protected readonly lastBackupAt = computed<Date | null>(() => {
    const times = this.backups().map((b) => new Date(b.createdAt).getTime()).filter((t) => !Number.isNaN(t));
    return times.length ? new Date(Math.max(...times)) : null;
  });
  protected readonly hoursSinceLastBackup = computed<number | null>(() => {
    const last = this.lastBackupAt();
    return last ? Math.floor((Date.now() - last.getTime()) / 3_600_000) : null;
  });
  protected readonly backupStale = computed<boolean>(() => {
    if (this.loading()) return false;
    const h = this.hoursSinceLastBackup();
    return h === null || h > this.staleThresholdH;
  });

  constructor() { this.load(); }

  private byEnv(env: 'prod' | 'dev'): Backup[] {
    return this.backups()
      .filter((b) => (b.target.includes('_prod') ? 'prod' : 'dev') === env)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  load(): void {
    this.loading.set(true);
    this.vpsApi.listBackups().pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => { this.backups.set(r.data ?? []); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  quickBackup(target: BackupTarget): void {
    this.backingUp.set(target);
    this.vpsApi.createBackup(target).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => { this.backups.update((list) => [r.data, ...list]); this.backingUp.set(null); }, error: () => this.backingUp.set(null) });
  }

  startBackup(): void {
    const target = this.selectedTarget();
    if (!target) return;
    this.quickBackup(target);
    this.showModal.set(false);
    this.selectedTarget.set(null);
  }

  confirmRestore(b: Backup): void { this.restoreTarget.set(b); this.restoreConfirmInput.set(''); }
  doRestore(): void {
    const b = this.restoreTarget();
    if (!b || this.restoreConfirmInput() !== 'RESTAURER') return;
    this.restoring.set(b.filename);
    this.vpsApi.restoreBackup(b.filename).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => { this.restoring.set(null); this.restoreTarget.set(null); }, error: () => this.restoring.set(null) });
  }

  confirmDeleteB(b: Backup): void { this.deleteTarget.set(b); }
  doDelete(): void {
    const b = this.deleteTarget();
    if (!b) return;
    this.vpsApi.deleteBackup(b.filename).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => { this.backups.update((list) => list.filter((x) => x.filename !== b.filename)); this.deleteTarget.set(null); } });
  }
}
