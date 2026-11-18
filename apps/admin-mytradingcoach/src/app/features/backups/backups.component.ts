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
  LucideX as X,
  LucideAlertTriangle as AlertTriangle,
} from '@lucide/angular';
import { VpsApi, Backup } from '../../core/api/vps.api';
import { DialogDirective, ErrorStateComponent } from '@mtc/front-ui';
import { apiErrorMessage } from '@mtc/shared';

/** Cibles d'un backup manuel. « Config API » (api_*) retirées (A16 #1065) : l'API les refusait toujours (400). */
type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'bdd_beta';

const TARGET_CONFIG: Record<BackupTarget, { label: string; color: string; icon: string; desc: string }> = {
  bdd_prod: { label: 'BDD Production', color: '#00d4aa', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_prod' },
  bdd_dev:  { label: 'BDD Dev',        color: '#4a9eff', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_dev' },
  bdd_beta: { label: 'BDD Beta',       color: '#e879f9', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_beta' },
};

@Component({
  selector: 'mtc-admin-backups',
  imports: [DialogDirective, DatePipe, ErrorStateComponent, LucideDynamicIcon],
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
  protected readonly XIcon = X;
  protected readonly AlertIcon = AlertTriangle;

  /** Seuil au-delà duquel on alerte que la dernière sauvegarde est trop ancienne. */
  protected readonly staleThresholdH = 48;

  protected readonly loading = signal(true);
  /** Liste non chargée (A16 #1065) : « indisponible », jamais la fausse alerte « Aucune sauvegarde ». */
  protected readonly loadError = signal(false);
  /** Échec d'un backup manuel ou d'une suppression (A16 #1065), affiché en haut de page. */
  protected readonly actionError = signal<string | null>(null);
  protected readonly deleting = signal(false);
  protected readonly backups = signal<Backup[]>([]);
  protected readonly backingUp = signal<BackupTarget | null>(null);
  protected readonly showModal = signal(false);
  protected readonly selectedTarget = signal<BackupTarget | null>(null);
  protected readonly deleteTarget = signal<Backup | null>(null);

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
    if (this.loading() || this.loadError()) return false;
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
    this.loadError.set(false);
    this.vpsApi.listBackups().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => { this.backups.set(r.data ?? []); this.loading.set(false); },
      error: () => { this.loading.set(false); this.loadError.set(true); },
    });
  }

  quickBackup(target: BackupTarget): void {
    this.backingUp.set(target);
    this.actionError.set(null);
    this.vpsApi.createBackup(target).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (r) => { this.backups.update((list) => [r.data, ...list]); this.backingUp.set(null); },
      error: (err) => {
        this.backingUp.set(null);
        this.actionError.set(apiErrorMessage(err, 'Le backup n’a pas pu être lancé. Réessaie.'));
      },
    });
  }

  startBackup(): void {
    const target = this.selectedTarget();
    if (!target) return;
    this.quickBackup(target);
    this.showModal.set(false);
    this.selectedTarget.set(null);
  }

  confirmDeleteB(b: Backup): void { this.deleteTarget.set(b); }
  doDelete(): void {
    const b = this.deleteTarget();
    if (!b || this.deleting()) return; // double clic : une seule suppression
    this.deleting.set(true);
    this.actionError.set(null);
    const removed = () => {
      this.backups.update((list) => list.filter((x) => x.filename !== b.filename));
      this.deleting.set(false);
      this.deleteTarget.set(null);
    };
    this.vpsApi.deleteBackup(b.filename).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: removed,
      error: (err: { status?: number }) => {
        if (err?.status === 404) { removed(); return; } // déjà supprimé
        this.deleting.set(false);
        this.deleteTarget.set(null);
        this.actionError.set(apiErrorMessage(err, 'La suppression a échoué. Réessaie.'));
      },
    });
  }
}
