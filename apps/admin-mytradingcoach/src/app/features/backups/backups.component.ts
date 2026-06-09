import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, inject, signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, RefreshCw, Plus, Trash2, RotateCcw, X, AlertTriangle } from 'lucide-angular';
import { VpsApi, Backup } from '../../core/api/vps.api';

type BackupTarget = 'bdd_prod' | 'bdd_dev' | 'api_prod' | 'api_dev';

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
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Sauvegardes</div>
        <div class="head-actions">
          <button class="icon-btn" title="Rafraîchir" (click)="load()" [disabled]="loading()"><lucide-icon [img]="RefreshIcon" [size]="14" /></button>
          <button class="btn btn-primary" (click)="showModal.set(true)"><lucide-icon [img]="PlusIcon" [size]="13" /> Nouveau backup</button>
        </div>
      </div>

      @if (backupStale()) {
        <div class="backup-alert" [class.critical]="lastBackupAt() === null">
          <lucide-icon [img]="AlertIcon" [size]="18" />
          @if (lastBackupAt() === null) {
            <div><strong>Aucune sauvegarde trouvée.</strong> <span class="backup-alert-sub">Lance un backup ou vérifie le cron sur le VPS.</span></div>
          } @else {
            <div><strong>Dernière sauvegarde il y a {{ hoursSinceLastBackup() }} h</strong>
              <span class="backup-alert-sub">— au-delà du seuil de {{ staleThresholdH }} h ({{ lastBackupAt() | date:'dd/MM/yyyy HH:mm' }}). Vérifie le backup automatique.</span></div>
          }
        </div>
      }

      <div class="kpi-strip cols-4">
        <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">Total</div><div class="kpi-value teal">{{ backups().length }}</div><div class="kpi-sub">sauvegardes</div></div>
        <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">Automatiques</div><div class="kpi-value blue">{{ autoCount() }}</div><div class="kpi-sub">cron quotidien</div></div>
        <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Manuels</div><div class="kpi-value purple">{{ manualCount() }}</div><div class="kpi-sub">déclenchés admin</div></div>
        <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Taille totale</div><div class="kpi-value amber">{{ totalSizeMb() }} Mo</div><div class="kpi-sub">conservation 14j</div></div>
      </div>

      @if (loading()) {
        <div class="card"><div class="empty">Chargement des sauvegardes…</div></div>
      } @else if (backups().length === 0) {
        <div class="card"><div class="empty">Aucune sauvegarde trouvée.<br /><button class="btn btn-primary" style="margin-top:12px" (click)="showModal.set(true)">Créer la première sauvegarde</button></div></div>
      } @else {
        <div class="bk-cols">
          <div class="card fill">
            <div class="card-head"><span class="card-label">Production</span><span class="badge b-ok">prod · {{ prodBackups().length }}</span></div>
            <table class="tbl">
              <thead><tr><th>Fichier</th><th>Type</th><th>Taille</th><th>Créée</th><th class="actions-col">Actions</th></tr></thead>
              <tbody>
                @for (b of prodBackups(); track b.filename) {
                  <tr>
                    <td data-label="Fichier" class="td-mono">{{ b.filename }}</td>
                    <td data-label="Type">@if (b.type === 'auto') { <span class="badge b-ok">auto</span> } @else { <span class="badge b-beta">manuel</span> }</td>
                    <td data-label="Taille" class="td-mono">{{ b.sizeMb }} Mo</td>
                    <td data-label="Créée" class="td-mono muted">{{ b.createdAt | date:'dd/MM HH:mm' }}</td>
                    <td data-label="Actions"><div class="row-actions">
                      <button class="icon-btn" title="Restaurer" (click)="confirmRestore(b)" [disabled]="restoring() === b.filename"><lucide-icon [img]="RestoreIcon" [size]="12" /></button>
                      <button class="icon-btn danger" title="Supprimer" (click)="confirmDeleteB(b)"><lucide-icon [img]="TrashIcon" [size]="12" /></button>
                    </div></td>
                  </tr>
                } @empty { <tr><td colspan="5" class="empty">Aucune sauvegarde prod</td></tr> }
              </tbody>
            </table>
          </div>

          <div class="card fill">
            <div class="card-head"><span class="card-label">Développement</span><span class="badge b-beta">dev · {{ devBackups().length }}</span></div>
            <table class="tbl">
              <thead><tr><th>Fichier</th><th>Type</th><th>Taille</th><th>Créée</th><th class="actions-col">Actions</th></tr></thead>
              <tbody>
                @for (b of devBackups(); track b.filename) {
                  <tr>
                    <td data-label="Fichier" class="td-mono">{{ b.filename }}</td>
                    <td data-label="Type">@if (b.type === 'auto') { <span class="badge b-ok">auto</span> } @else { <span class="badge b-beta">manuel</span> }</td>
                    <td data-label="Taille" class="td-mono">{{ b.sizeMb }} Mo</td>
                    <td data-label="Créée" class="td-mono muted">{{ b.createdAt | date:'dd/MM HH:mm' }}</td>
                    <td data-label="Actions"><div class="row-actions">
                      <button class="icon-btn" title="Restaurer" (click)="confirmRestore(b)" [disabled]="restoring() === b.filename"><lucide-icon [img]="RestoreIcon" [size]="12" /></button>
                      <button class="icon-btn danger" title="Supprimer" (click)="confirmDeleteB(b)"><lucide-icon [img]="TrashIcon" [size]="12" /></button>
                    </div></td>
                  </tr>
                } @empty { <tr><td colspan="5" class="empty">Aucune sauvegarde dev</td></tr> }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Modal Nouveau backup -->
      @if (showModal()) {
        <div class="modal-overlay" role="button" tabindex="0" (click)="showModal.set(false)" (keydown.escape)="showModal.set(false)">
          <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <div class="modal-header"><h2 class="modal-title">Nouveau backup manuel</h2>
              <button class="icon-btn" (click)="showModal.set(false)" aria-label="Fermer"><lucide-icon [img]="XIcon" [size]="16" /></button></div>
            <div class="modal-body">
              <p class="modal-desc">Sélectionne ce que tu veux sauvegarder :</p>
              <div class="target-grid">
                @for (entry of targetEntries; track entry.key) {
                  <button class="target-card" [class.selected]="selectedTarget() === entry.key" (click)="selectedTarget.set(entry.key)">
                    <div class="target-dot" [style.background]="entry.color"></div>
                    <span class="target-icon">{{ entry.icon }}</span>
                    <span class="target-label">{{ entry.label }}</span>
                    <span class="target-desc">{{ entry.desc }}</span>
                  </button>
                }
              </div>
            </div>
            <div class="modal-footer">
              <button class="btn" (click)="showModal.set(false)">Annuler</button>
              <button class="btn btn-primary" [disabled]="!selectedTarget() || backingUp() !== null" (click)="startBackup()">{{ backingUp() ? 'Sauvegarde…' : 'Lancer le backup' }}</button>
            </div>
          </div>
        </div>
      }

      <!-- Modal Restauration -->
      @if (restoreTarget()) {
        <div class="modal-overlay" role="button" tabindex="0" (click)="restoreTarget.set(null)" (keydown.escape)="restoreTarget.set(null)">
          <div class="modal modal-sm" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <div class="modal-header"><h2 class="modal-title danger-title">⚠️ Confirmer la restauration</h2>
              <button class="icon-btn" (click)="restoreTarget.set(null)" aria-label="Fermer"><lucide-icon [img]="XIcon" [size]="16" /></button></div>
            <div class="modal-body">
              <p class="modal-desc">Tu es sur le point de restaurer :<br /><strong>{{ restoreTarget()!.filename }}</strong></p>
              <div class="warning-box">⚠️ Cette action écrase les données actuelles. Irréversible.</div>
              <p class="modal-desc">Tape <strong>RESTAURER</strong> pour confirmer :</p>
              <label for="restore-confirm" class="sr-only">Confirmation</label>
              <input id="restore-confirm" class="confirm-input" type="text" [value]="restoreConfirmInput()" (input)="restoreConfirmInput.set($any($event.target).value)" placeholder="RESTAURER" />
            </div>
            <div class="modal-footer">
              <button class="btn" (click)="restoreTarget.set(null)">Annuler</button>
              <button class="btn btn-danger" [disabled]="restoreConfirmInput() !== 'RESTAURER' || restoring() !== null" (click)="doRestore()">{{ restoring() ? 'Restauration…' : 'Restaurer' }}</button>
            </div>
          </div>
        </div>
      }

      <!-- Modal Suppression -->
      @if (deleteTarget()) {
        <div class="modal-overlay" role="button" tabindex="0" (click)="deleteTarget.set(null)" (keydown.escape)="deleteTarget.set(null)">
          <div class="modal modal-sm" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
            <div class="modal-header"><h2 class="modal-title danger-title">Supprimer ce backup ?</h2>
              <button class="icon-btn" (click)="deleteTarget.set(null)" aria-label="Fermer"><lucide-icon [img]="XIcon" [size]="16" /></button></div>
            <div class="modal-body"><p class="modal-desc">Supprimer définitivement :<br /><strong>{{ deleteTarget()!.filename }}</strong></p></div>
            <div class="modal-footer">
              <button class="btn" (click)="deleteTarget.set(null)">Annuler</button>
              <button class="btn btn-danger" (click)="doDelete()">Supprimer</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
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
