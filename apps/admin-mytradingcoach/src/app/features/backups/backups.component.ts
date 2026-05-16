import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of } from 'rxjs';
import { LucideAngularModule, Plus, Trash2 } from 'lucide-angular';
import { VpsApi, Backup } from '../../core/api/vps.api';

@Component({
  selector: 'mtc-admin-backups',
  standalone: true,
  imports: [DatePipe, DecimalPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './backups.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Sauvegardes</h1>
        <button class="btn-primary" (click)="createBackup()" [disabled]="creating()">
          <lucide-icon [img]="PlusIcon" [size]="12" />
          {{ creating() ? 'Création...' : 'Nouveau backup' }}
        </button>
      </div>
      @if (loading()) {
        <div class="empty-state">Chargement...</div>
      } @else if (error()) {
        <div class="empty-state">
          <span>Module Sauvegardes non disponible</span>
          <span>Déployer le module NestJS VPS pour activer cette section.</span>
        </div>
      } @else {
      <div class="card">
        @for (b of backups(); track b.filename) {
          <div class="backup-row">
            <div class="backup-icon">💾</div>
            <div class="backup-info">
              <div class="backup-name">{{ b.filename }}</div>
              <div class="backup-meta">{{ b.createdAt | date:'dd/MM/yyyy HH:mm' }}</div>
            </div>
            <span class="backup-size">{{ (b.size / 1048576) | number:'1.1-1' }} Mo</span>
            <span class="tag" [class.auto]="b.type==='auto'" [class.manual]="b.type==='manual'">{{ b.type }}</span>
            <button class="action-btn danger" (click)="deleteBackup(b.filename)" title="Supprimer">
              <lucide-icon [img]="TrashIcon" [size]="10" />
            </button>
          </div>
        }
        @if (backups().length === 0) {
          <div class="empty-state">Aucune sauvegarde disponible</div>
        }
      </div>
      }
    </div>
  `,
})
export class BackupsComponent {
  private readonly vpsApi = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly backups = signal<Backup[]>([]);
  protected readonly creating = signal(false);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;

  constructor() {
    this.vpsApi.backups()
      .pipe(
        catchError(() => {
          this.error.set(true);
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(r => {
        if (r) this.backups.set(r.data);
        this.loading.set(false);
      });
  }

  protected createBackup() {
    this.creating.set(true);
    this.vpsApi.createBackup().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.creating.set(false); this.vpsApi.backups().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => this.backups.set(r.data)); },
      error: () => this.creating.set(false),
    });
  }

  protected deleteBackup(f: string) {
    if (!confirm('Supprimer cette sauvegarde ?')) return;
    this.vpsApi.deleteBackup(f).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() =>
      this.backups.update(bs => bs.filter(b => b.filename !== f)));
  }
}
