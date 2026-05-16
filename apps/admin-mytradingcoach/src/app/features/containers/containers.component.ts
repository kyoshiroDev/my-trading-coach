import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, of } from 'rxjs';
import { catchError, startWith, switchMap } from 'rxjs/operators';
import { LucideAngularModule, Play, Square, RotateCcw, Trash2 } from 'lucide-angular';
import { VpsApi, DockerContainer } from '../../core/api/vps.api';

@Component({
  selector: 'mtc-admin-containers',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './containers.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Containers Docker</h1>
        <span class="refresh-hint">Auto 10s</span>
      </div>
      <div class="card">
        @for (c of containers(); track c.id) {
          <div class="container-row">
            <div class="container-status" [class]="c.status"></div>
            <div class="container-info">
              <div class="container-name">{{ c.name }}</div>
              <div class="container-image">{{ c.image }}</div>
            </div>
            <span class="container-cpu">{{ c.cpu }}%</span>
            <div class="container-actions">
              @if (c.status !== 'running') {
                <button class="action-btn success" (click)="action(c.id,'start')" title="Démarrer">
                  <lucide-icon [img]="PlayIcon" [size]="10" />
                </button>
              }
              @if (c.status === 'running') {
                <button class="action-btn" (click)="action(c.id,'stop')" title="Arrêter">
                  <lucide-icon [img]="StopIcon" [size]="10" />
                </button>
              }
              <button class="action-btn" (click)="action(c.id,'restart')" title="Redémarrer">
                <lucide-icon [img]="RestartIcon" [size]="10" />
              </button>
              <button class="action-btn danger" (click)="deleteContainer(c.id)" title="Supprimer">
                <lucide-icon [img]="TrashIcon" [size]="10" />
              </button>
            </div>
          </div>
        }
        @if (containers().length === 0) {
          <div class="empty-state">Module Docker non disponible</div>
        }
      </div>
    </div>
  `,
})
export class ContainersComponent {
  private readonly vpsApi = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly containers = signal<DockerContainer[]>([]);

  protected readonly PlayIcon = Play;
  protected readonly StopIcon = Square;
  protected readonly RestartIcon = RotateCcw;
  protected readonly TrashIcon = Trash2;

  constructor() {
    interval(10_000).pipe(
      startWith(0),
      switchMap(() => this.vpsApi.containers().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => this.containers.set(r?.data ?? []));
  }

  protected action(id: string, a: 'start' | 'stop' | 'restart') {
    const obs = a === 'start' ? this.vpsApi.startContainer(id)
      : a === 'stop' ? this.vpsApi.stopContainer(id)
      : this.vpsApi.restartContainer(id);
    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() =>
      this.vpsApi.containers().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(r => this.containers.set(r.data)));
  }

  protected deleteContainer(id: string) {
    if (!confirm('Supprimer ce container ?')) return;
    this.vpsApi.deleteContainer(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() =>
      this.containers.update(cs => cs.filter(c => c.id !== id)));
  }
}
