import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, inject, signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { LucideAngularModule, Play, Square, RotateCcw, Trash2 } from 'lucide-angular';
import { VpsApi, DockerContainer } from '../../core/api/vps.api';

interface ContainerGroup {
  label: string;
  color: string;
  containers: DockerContainer[];
}

@Component({
  selector: 'mtc-admin-containers',
  standalone: true,
  imports: [DecimalPipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './containers.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Containers Docker</h1>
        <span class="refresh-hint mono-text">Auto 10s</span>
      </div>

      @if (loading()) {
        <div class="loading-state">Connexion au VPS...</div>
      } @else if (error()) {
        <div class="error-state">
          ⚠️ Impossible de récupérer les containers
        </div>
      } @else {
        <div class="containers-stats">
          <div class="cstat">
            <div class="cstat-val">{{ allContainers().length }}</div>
            <div class="cstat-label">Total</div>
          </div>
          <div class="cstat green">
            <div class="cstat-val">{{ runningCount() }}</div>
            <div class="cstat-label">Running</div>
          </div>
          <div class="cstat red">
            <div class="cstat-val">{{ stoppedCount() }}</div>
            <div class="cstat-label">Arrêtés</div>
          </div>
        </div>

        @for (group of groups(); track group.label) {
          @if (group.containers.length) {
            <div class="group-section">
              <div class="group-header">
                <div class="group-dot" [style.background]="group.color"></div>
                <span class="group-label">{{ group.label }}</span>
                <span class="group-count">{{ group.containers.length }} container{{ group.containers.length > 1 ? 's' : '' }}</span>
                <span class="group-running">{{ group.containers.filter(c => c.status === 'running').length }} running</span>
              </div>

              <div class="containers-grid">
                @for (c of group.containers; track c.id) {
                  <div class="container-card"
                    [class.stopped]="c.status !== 'running'"
                    [class.error-card]="c.status === 'error'">

                    <div class="container-card-header">
                      <div class="container-status-dot"
                        [class.running]="c.status==='running'"
                        [class.error]="c.status==='error'"
                        [class.stopped]="c.status==='stopped'">
                      </div>
                      <div class="container-name">{{ c.name }}</div>
                      <div class="container-actions">
                        @if (c.status !== 'running') {
                          <button class="caction-btn success" title="Démarrer"
                            (click)="action(c.name, 'start')">
                            <lucide-icon [img]="PlayIcon" [size]="11" />
                          </button>
                        } @else {
                          <button class="caction-btn warning" title="Arrêter"
                            (click)="action(c.name, 'stop')">
                            <lucide-icon [img]="StopIcon" [size]="11" />
                          </button>
                        }
                        <button class="caction-btn" title="Redémarrer"
                          (click)="action(c.name, 'restart')">
                          <lucide-icon [img]="RestartIcon" [size]="11" />
                        </button>
                      </div>
                    </div>

                    <div class="container-image">{{ c.image }}</div>

                    @if (c.status === 'running') {
                      <div class="container-metrics">
                        <div class="metric">
                          <div class="metric-header">
                            <span class="metric-name">CPU</span>
                            <span class="metric-val">{{ c.cpu | number:'1.1-1' }}%</span>
                          </div>
                          <div class="metric-bar">
                            <div class="metric-fill cpu"
                              [style.width.%]="mathMin(c.cpu, 100)"
                              [class.warn]="c.cpu > 50"
                              [class.danger]="c.cpu > 80">
                            </div>
                          </div>
                        </div>
                        <div class="metric">
                          <div class="metric-header">
                            <span class="metric-name">RAM</span>
                            <span class="metric-val">
                              {{ c.ram }}MB @if (c.ramLimit > 0) { / {{ c.ramLimit }}MB }
                            </span>
                          </div>
                          <div class="metric-bar">
                            <div class="metric-fill ram"
                              [style.width.%]="c.ramLimit > 0 ? mathMin((c.ram/c.ramLimit)*100, 100) : 0"
                              [class.warn]="c.ramLimit > 0 && (c.ram/c.ramLimit) > 0.7"
                              [class.danger]="c.ramLimit > 0 && (c.ram/c.ramLimit) > 0.9">
                            </div>
                          </div>
                        </div>
                      </div>
                    } @else {
                      <div class="container-stopped-label">
                        {{ c.status === 'error' ? '⚠️ Erreur' : '⏸ Arrêté' }}
                      </div>
                    }
                  </div>
                }
              </div>
            </div>
          }
        }
      }
    </div>
  `,
})
export class ContainersComponent {
  private readonly vpsApi     = inject(VpsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly PlayIcon    = Play;
  protected readonly StopIcon    = Square;
  protected readonly RestartIcon = RotateCcw;
  protected readonly TrashIcon   = Trash2;

  protected readonly loading       = signal(true);
  protected readonly error         = signal(false);
  protected readonly allContainers = signal<DockerContainer[]>([]);

  protected readonly runningCount = computed(() =>
    this.allContainers().filter(c => c.status === 'running').length,
  );
  protected readonly stoppedCount = computed(() =>
    this.allContainers().filter(c => c.status !== 'running').length,
  );

  protected readonly groups = computed((): ContainerGroup[] => {
    const all = this.allContainers();
    return [
      { label: 'PRODUCTION',     color: '#00d4aa', containers: all.filter(c => c.name.includes('_prod') || c.name.includes('discord')) },
      { label: 'DÉVELOPPEMENT',  color: '#4a9eff', containers: all.filter(c => c.name.includes('_dev')) },
      { label: 'INFRASTRUCTURE', color: '#f5a623', containers: all.filter(c => !c.name.includes('_prod') && !c.name.includes('_dev') && !c.name.includes('discord')) },
    ];
  });

  protected mathMin(a: number, b: number): number { return Math.min(a, b); }

  constructor() {
    interval(10_000).pipe(
      startWith(0),
      switchMap(() =>
        this.vpsApi.containers().pipe(
          catchError(() => { this.error.set(true); return of(null); }),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => {
      if (r) { this.allContainers.set(r.data ?? []); this.error.set(false); }
      this.loading.set(false);
    });
  }

  protected action(id: string, act: 'start' | 'stop' | 'restart'): void {
    this.vpsApi.containerAction(id, act)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }
}