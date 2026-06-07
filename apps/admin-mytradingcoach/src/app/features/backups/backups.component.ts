import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, inject, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, RefreshCw, Plus, Trash2, RotateCcw, X, AlertTriangle } from 'lucide-angular';
import { VpsApi, Backup } from '../../core/api/vps.api';

type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev';

interface BackupGroup {
  label: string;
  target: BackupTarget;
  color: string;
  icon: string;
  items: Backup[];
}

const TARGET_CONFIG: Record<BackupTarget, { label: string; color: string; icon: string; desc: string }> = {
  bdd_prod: { label: 'BDD Production', color: '#00d4aa', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_prod' },
  bdd_dev:  { label: 'BDD Dev',        color: '#4a9eff', icon: '🗄️', desc: 'PostgreSQL · mytradingcoach_dev' },
  api_prod: { label: 'Config API Prod',color: '#f5a623', icon: '📦', desc: 'docker-compose.prod.yml' },
  api_dev:  { label: 'Config API Dev', color: '#8b5cf6', icon: '📦', desc: 'docker-compose.dev.yml' },
};

@Component({
  selector: 'mtc-admin-backups',
  standalone: true,
  imports: [DatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './backups.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Sauvegardes</h1>
        <div class="header-actions">
          <button class="btn-icon" title="Rafraîchir" (click)="load()" [disabled]="loading()">
            <lucide-icon [img]="RefreshIcon" [size]="14" />
          </button>
          <button class="btn-primary" (click)="showModal.set(true)">
            <lucide-icon [img]="PlusIcon" [size]="13" />
            Nouveau backup
          </button>
        </div>
      </div>

      <!-- Alerte fraîcheur : aucune sauvegarde ou dernière > seuil -->
      @if (backupStale()) {
        <div class="backup-alert" [class.critical]="lastBackupAt() === null">
          <lucide-icon [img]="AlertIcon" [size]="18" />
          @if (lastBackupAt() === null) {
            <div>
              <strong>Aucune sauvegarde trouvée.</strong>
              <span class="backup-alert-sub">Lance un backup ou vérifie le cron sur le VPS.</span>
            </div>
          } @else {
            <div>
              <strong>Dernière sauvegarde il y a {{ hoursSinceLastBackup() }} h</strong>
              <span class="backup-alert-sub">
                — au-delà du seuil de {{ staleThresholdH }} h ({{ lastBackupAt() | date:'dd/MM/yyyy HH:mm' }}).
                Vérifie que le backup automatique tourne.
              </span>
            </div>
          }
        </div>
      }

      <!-- Stats -->
      <div class="backup-stats">
        <div class="bstat"><span class="bstat-val">{{ backups().length }}</span><span class="bstat-label">Total</span></div>
        <div class="bstat"><span class="bstat-val green">{{ autoCount() }}</span><span class="bstat-label">Automatiques</span></div>
        <div class="bstat"><span class="bstat-val amber">{{ manualCount() }}</span><span class="bstat-label">Manuels</span></div>
        <div class="bstat"><span class="bstat-val">{{ totalSizeMb() }} Mo</span><span class="bstat-label">Taille totale</span></div>
      </div>

      @if (loading()) {
        <div class="loading-state">Chargement des sauvegardes...</div>
      } @else if (backups().length === 0) {
        <div class="empty-state">
          Aucune sauvegarde trouvée.
          <button class="btn-primary" style="margin-top:12px" (click)="showModal.set(true)">
            Créer la première sauvegarde
          </button>
        </div>
      } @else {
        <div class="groups-grid">
          @for (group of groups(); track group.target) {
            <div class="group-card">
              <div class="group-card-header">
                <div class="group-dot" [style.background]="group.color"></div>
                <span class="group-label">{{ group.label }}</span>
                <span class="group-count">{{ group.items.length }}</span>
                <button class="btn-group-backup" title="Backup maintenant"
                  (click)="quickBackup(group.target)"
                  [disabled]="backingUp() === group.target">
                  {{ backingUp() === group.target ? '⏳' : '+' }}
                </button>
              </div>

              @if (group.items.length === 0) {
                <div class="group-empty">Aucune sauvegarde</div>
              } @else {
                @for (b of group.items; track b.filename) {
                  <div class="backup-row">
                    <div class="backup-icon">{{ group.icon }}</div>
                    <div class="backup-info">
                      <div class="backup-name">{{ b.filename }}</div>
                      <div class="backup-meta">
                        {{ b.createdAt | date:'dd/MM/yyyy HH:mm' }}
                        · {{ b.sizeMb }} Mo
                        <span class="backup-type" [class.auto]="b.type==='auto'" [class.manual]="b.type==='manual'">
                          {{ b.type === 'auto' ? 'Auto' : 'Manuel' }}
                        </span>
                      </div>
                    </div>
                    <div class="backup-actions">
                      <button class="action-btn restore-btn" title="Restaurer"
                        (click)="confirmRestore(b)"
                        [disabled]="restoring() === b.filename">
                        @if (restoring() === b.filename) {
                          <span style="font-size:10px">⏳</span>
                        } @else {
                          <lucide-icon [img]="RestoreIcon" [size]="12" />
                        }
                      </button>
                      <button class="action-btn delete-btn" title="Supprimer"
                        (click)="confirmDeleteB(b)">
                        <lucide-icon [img]="TrashIcon" [size]="12" />
                      </button>
                    </div>
                  </div>
                }
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- Modal Nouveau backup -->
    @if (showModal()) {
      <div class="modal-overlay" role="button" tabindex="0"
        (click)="showModal.set(false)" (keydown.escape)="showModal.set(false)">
        <div class="modal" role="dialog" aria-modal="true"
          (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 class="modal-title">Nouveau backup manuel</h2>
            <button class="modal-close" (click)="showModal.set(false)" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-desc">Sélectionne ce que tu veux sauvegarder :</p>
            <div class="target-grid">
              @for (entry of targetEntries; track entry.key) {
                <button class="target-card"
                  [class.selected]="selectedTarget() === entry.key"
                  (click)="selectedTarget.set(entry.key)">
                  <div class="target-dot" [style.background]="entry.color"></div>
                  <span class="target-icon">{{ entry.icon }}</span>
                  <span class="target-label">{{ entry.label }}</span>
                  <span class="target-desc">{{ entry.desc }}</span>
                </button>
              }
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" (click)="showModal.set(false)">Annuler</button>
            <button class="btn-primary"
              [disabled]="!selectedTarget() || backingUp() !== null"
              (click)="startBackup()">
              {{ backingUp() ? 'Sauvegarde en cours...' : 'Lancer le backup' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal Confirmer restauration -->
    @if (restoreTarget()) {
      <div class="modal-overlay" role="button" tabindex="0"
        (click)="restoreTarget.set(null)" (keydown.escape)="restoreTarget.set(null)">
        <div class="modal modal-sm" role="dialog" aria-modal="true"
          (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 class="modal-title danger-title">⚠️ Confirmer la restauration</h2>
            <button class="modal-close" (click)="restoreTarget.set(null)" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-desc">Tu es sur le point de restaurer :<br /><strong>{{ restoreTarget()!.filename }}</strong></p>
            <div class="warning-box">⚠️ Cette action écrase les données actuelles. Irréversible.</div>
            <p class="modal-desc">Tape <strong>RESTAURER</strong> pour confirmer :</p>
            <label for="restore-confirm" class="sr-only">Confirmation</label>
            <input id="restore-confirm" class="confirm-input" type="text"
              [value]="restoreConfirmInput()"
              (input)="restoreConfirmInput.set($any($event.target).value)"
              placeholder="RESTAURER" />
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" (click)="restoreTarget.set(null)">Annuler</button>
            <button class="btn-danger"
              [disabled]="restoreConfirmInput() !== 'RESTAURER' || restoring() !== null"
              (click)="doRestore()">
              {{ restoring() ? 'Restauration...' : 'Restaurer' }}
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Modal Confirmer suppression -->
    @if (deleteTarget()) {
      <div class="modal-overlay" role="button" tabindex="0"
        (click)="deleteTarget.set(null)" (keydown.escape)="deleteTarget.set(null)">
        <div class="modal modal-sm" role="dialog" aria-modal="true"
          (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-header">
            <h2 class="modal-title danger-title">Supprimer ce backup ?</h2>
            <button class="modal-close" (click)="deleteTarget.set(null)" aria-label="Fermer">
              <lucide-icon [img]="XIcon" [size]="16" />
            </button>
          </div>
          <div class="modal-body">
            <p class="modal-desc">Supprimer définitivement :<br /><strong>{{ deleteTarget()!.filename }}</strong></p>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" (click)="deleteTarget.set(null)">Annuler</button>
            <button class="btn-danger" (click)="doDelete()">Supprimer</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class BackupsComponent {
  private readonly vpsApi     = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly RefreshIcon = RefreshCw;
  protected readonly PlusIcon    = Plus;
  protected readonly TrashIcon   = Trash2;
  protected readonly RestoreIcon = RotateCcw;
  protected readonly XIcon       = X;
  protected readonly AlertIcon   = AlertTriangle;

  /** Seuil au-delà duquel on alerte que la dernière sauvegarde est trop ancienne. */
  protected readonly staleThresholdH = 48;

  protected readonly loading             = signal(true);
  protected readonly backups             = signal<Backup[]>([]);
  protected readonly backingUp           = signal<BackupTarget | null>(null);
  protected readonly restoring           = signal<string | null>(null);
  protected readonly showModal           = signal(false);
  protected readonly selectedTarget      = signal<BackupTarget | null>(null);
  protected readonly restoreTarget       = signal<Backup | null>(null);
  protected readonly deleteTarget        = signal<Backup | null>(null);
  protected readonly restoreConfirmInput = signal('');

  protected readonly targetEntries = Object.entries(TARGET_CONFIG).map(([key, val]) => ({
    key: key as BackupTarget, ...val,
  }));

  protected readonly autoCount   = computed(() => this.backups().filter(b => b.type === 'auto').length);
  protected readonly manualCount = computed(() => this.backups().filter(b => b.type === 'manual').length);
  protected readonly totalSizeMb = computed(() =>
    this.backups().reduce((s, b) => s + (b.sizeMb ?? 0), 0).toFixed(1),
  );

  /** Date de la sauvegarde la plus récente (toutes confondues), ou null si aucune. */
  protected readonly lastBackupAt = computed<Date | null>(() => {
    const times = this.backups()
      .map(b => new Date(b.createdAt).getTime())
      .filter(t => !Number.isNaN(t));
    return times.length ? new Date(Math.max(...times)) : null;
  });

  /** Heures écoulées depuis la dernière sauvegarde (null si aucune). */
  protected readonly hoursSinceLastBackup = computed<number | null>(() => {
    const last = this.lastBackupAt();
    return last ? Math.floor((Date.now() - last.getTime()) / 3_600_000) : null;
  });

  /** Vrai si aucune sauvegarde ou si la dernière dépasse le seuil. */
  protected readonly backupStale = computed<boolean>(() => {
    if (this.loading()) return false;
    const h = this.hoursSinceLastBackup();
    return h === null || h > this.staleThresholdH;
  });

  protected readonly groups = computed((): BackupGroup[] =>
    Object.entries(TARGET_CONFIG).map(([target, cfg]) => ({
      ...cfg,
      target: target as BackupTarget,
      items: this.backups()
        .filter(b => b.target === target)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10),
    })),
  );

  constructor() { this.load(); }

  load(): void {
    this.loading.set(true);
    this.vpsApi.listBackups()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => { this.backups.set(r.data ?? []); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
  }

  quickBackup(target: BackupTarget): void {
    this.backingUp.set(target);
    this.vpsApi.createBackup(target)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => { this.backups.update(list => [r.data, ...list]); this.backingUp.set(null); },
        error: () => this.backingUp.set(null),
      });
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
    this.vpsApi.restoreBackup(b.filename)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => { this.restoring.set(null); this.restoreTarget.set(null); },
        error: () => this.restoring.set(null),
      });
  }

  confirmDeleteB(b: Backup): void { this.deleteTarget.set(b); }

  doDelete(): void {
    const b = this.deleteTarget();
    if (!b) return;
    this.vpsApi.deleteBackup(b.filename)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.backups.update(list => list.filter(x => x.filename !== b.filename));
          this.deleteTarget.set(null);
        },
      });
  }
}
