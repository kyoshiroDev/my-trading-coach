import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  OnDestroy, ViewChild, computed, inject, signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, filter, interval, of, startWith, switchMap } from 'rxjs';
import { LucideAngularModule, Play, Square, RotateCcw, Pause, Trash2, RefreshCw } from 'lucide-angular';
import { VpsApi, VpsStats, DockerContainer } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { environment } from '../../../environments/environment';

interface HealthCard { label: string; status: 'ok' | 'down' | 'unknown'; meta: string; }
interface ContainerGroup { label: string; color: string; containers: DockerContainer[]; }

const LOG_CONTAINERS = ['mtc_api_prod', 'mtc_api_dev', 'mtc_postgres', 'mtc_redis', 'mtc_pgbouncer', 'mtc_traefik'];

@Component({
  selector: 'mtc-admin-surveillance',
  standalone: true,
  imports: [DecimalPipe, FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './surveillance.component.css',
  template: `
    <div class="content">
      <div class="page-header">
        <h1 class="page-title">Surveillance</h1>
        <div class="header-right">
          <span class="refresh-hint">↻ 15s</span>
          <button class="btn-icon" (click)="refresh()" [disabled]="loadingStats()" aria-label="Forcer refresh">
            <lucide-icon [img]="RefreshIcon" [size]="13" />
          </button>
        </div>
      </div>

      <!-- ── Santé ── -->
      <div class="health-row">
        @for (h of health(); track h.label) {
          <div class="health-card" [class]="'health-' + h.status">
            <div class="health-dot" [class]="h.status"></div>
            <div class="health-info">
              <div class="health-label">{{ h.label }}</div>
              <div class="health-meta">{{ h.meta }}</div>
            </div>
            <div class="health-status-badge" [class]="h.status">
              {{ h.status === 'ok' ? 'OK' : h.status === 'down' ? 'DOWN' : '...' }}
            </div>
          </div>
        }
      </div>

      @if (healthHasDown()) {
        <div class="alert-banner">
          ⚠️ Un service est inaccessible — vérifier les logs ci-dessous
        </div>
      }

      <!-- ── Ressources VPS ── -->
      <div class="two-col">
        <div class="card">
          <div class="card-header">
            <span class="card-title">Ressources système</span>
            @if (loadingStats()) { <span class="refresh-hint">chargement…</span> }
          </div>
          @if (stats(); as s) {
            <div class="metric-row">
              <span class="metric-label">CPU</span>
              <div class="metric-bar">
                <div class="metric-fill"
                  [class.teal]="s.cpu<=60" [class.amber]="s.cpu>60&&s.cpu<=80" [class.red]="s.cpu>80"
                  [style.width.%]="s.cpu"></div>
              </div>
              <span class="metric-val">{{ s.cpu }}%</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">RAM</span>
              <div class="metric-bar">
                <div class="metric-fill blue" [style.width.%]="(s.ram.used/s.ram.total)*100"></div>
              </div>
              <span class="metric-val">{{ (s.ram.used/1073741824) | number:'1.1-1' }}G / {{ (s.ram.total/1073741824) | number:'1.1-1' }}G</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Disque</span>
              <div class="metric-bar">
                <div class="metric-fill amber" [style.width.%]="(s.disk.used/s.disk.total)*100"
                  [class.red]="(s.disk.used/s.disk.total)>0.85"></div>
              </div>
              <span class="metric-val">{{ (s.disk.used/1073741824) | number:'1.0-0' }}G / {{ (s.disk.total/1073741824) | number:'1.0-0' }}G</span>
            </div>
            <div class="metric-row">
              <span class="metric-label">Réseau ↑</span>
              <div class="metric-bar">
                <div class="metric-fill" style="background:var(--purple);width:30%"></div>
              </div>
              <span class="metric-val">{{ (s.network.up/1024) | number:'1.0-0' }} KB/s</span>
            </div>
          } @else {
            <div class="empty-state">{{ loadingStats() ? 'Connexion SSH...' : 'VPS non disponible' }}</div>
          }
        </div>

        <div class="card">
          <div class="card-header"><span class="card-title">Informations</span></div>
          @if (stats(); as s) {
            <div class="info-row"><span class="info-label">IP</span><span class="info-val">{{ s.ip }}</span></div>
            <div class="info-row"><span class="info-label">OS</span><span class="info-val">{{ s.os }}</span></div>
            <div class="info-row"><span class="info-label">Kernel</span><span class="info-val">{{ s.kernel }}</span></div>
            <div class="info-row"><span class="info-label">Node</span><span class="info-val">{{ s.node }}</span></div>
            <div class="info-row"><span class="info-label">Docker</span><span class="info-val">{{ s.docker }}</span></div>
            <div class="info-row"><span class="info-label">Uptime</span><span class="info-val">{{ formatUptime(s.uptime) }}</span></div>
          } @else {
            <div class="empty-state">—</div>
          }
        </div>
      </div>

      <!-- ── Containers ── -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Containers Docker</span>
          <div class="container-counts">
            <span class="cstat-badge green">{{ runningCount() }} running</span>
            @if (stoppedCount() > 0) {
              <span class="cstat-badge red">{{ stoppedCount() }} arrêtés</span>
            }
          </div>
        </div>

        @if (loadingContainers() && allContainers().length === 0) {
          <div class="empty-state">Connexion au VPS...</div>
        } @else {
          @for (group of groups(); track group.label) {
            @if (group.containers.length) {
              <div class="group-section">
                <div class="group-header">
                  <div class="group-dot" [style.background]="group.color"></div>
                  <span class="group-label">{{ group.label }}</span>
                  <span class="group-count mono-text text3-color">{{ group.containers.length }}</span>
                </div>
                <div class="containers-list">
                  @for (c of group.containers; track c.id) {
                    <div class="container-row" [class.stopped]="c.status !== 'running'">
                      <div class="container-status-dot"
                        [class.running]="c.status==='running'"
                        [class.stopped]="c.status==='stopped'"
                        [class.error]="c.status==='error'">
                      </div>
                      <span class="container-name">{{ c.name }}</span>
                      <span class="container-image text3-color">{{ c.image }}</span>
                      @if (c.status === 'running') {
                        <span class="container-cpu mono-text" [class.text-amber]="c.cpu > 50">{{ c.cpu | number:'1.1-1' }}%</span>
                        <span class="container-ram mono-text text3-color">{{ c.ram }}MB</span>
                      } @else {
                        <span class="container-cpu" style="color:var(--red)">{{ c.status === 'error' ? '⚠ erreur' : '⏸ arrêté' }}</span>
                      }
                      <div class="container-actions">
                        @if (c.status !== 'running') {
                          <button class="action-btn success" title="Démarrer" (click)="containerAction(c.name, 'start')">
                            <lucide-icon [img]="PlayIcon" [size]="11" />
                          </button>
                        } @else {
                          <button class="action-btn danger" title="Arrêter" (click)="containerAction(c.name, 'stop')">
                            <lucide-icon [img]="StopIcon" [size]="11" />
                          </button>
                        }
                        <button class="action-btn" title="Redémarrer" (click)="containerAction(c.name, 'restart')">
                          <lucide-icon [img]="RestartIcon" [size]="11" />
                        </button>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          }
        }
      </div>

      <!-- ── Logs live ── -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">Logs live</span>
          <div class="log-controls">
            <select class="log-select" [(ngModel)]="selectedContainer">
              @for (c of logContainers; track c) { <option [value]="c">{{ c }}</option> }
            </select>
            @if (!streaming()) {
              <button class="btn-launch" (click)="startStream()">
                <lucide-icon [img]="PlayIcon" [size]="11" /> Lancer
              </button>
            } @else {
              <button class="action-btn" (click)="togglePause()" [title]="paused() ? 'Reprendre' : 'Pause'">
                <lucide-icon [img]="paused() ? PlayIcon : PauseIcon" [size]="11" />
              </button>
              <button class="action-btn" (click)="stopStream()" title="Arrêter">
                <lucide-icon [img]="StopIcon" [size]="11" />
              </button>
              <button class="action-btn" (click)="clearLines()" title="Vider">
                <lucide-icon [img]="TrashIcon" [size]="11" />
              </button>
            }
          </div>
        </div>
        <div class="log-terminal" #terminal>
          @for (line of lines(); track $index) {
            <div class="log-line" [class]="lineClass(line)">{{ line }}</div>
          }
          @if (!streaming()) {
            <div class="log-empty">Sélectionne un container et clique sur "Lancer"</div>
          } @else if (lines().length === 0) {
            <div class="log-empty">En attente de logs...</div>
          }
        </div>
      </div>
    </div>
  `,
})
export class SurveillanceComponent implements OnDestroy {
  @ViewChild('terminal') terminalRef!: ElementRef<HTMLDivElement>;

  private readonly vpsApi     = inject(VpsApi);
  private readonly auth       = inject(AdminAuthService);
  private readonly http       = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly PlayIcon    = Play;
  protected readonly StopIcon    = Square;
  protected readonly RestartIcon = RotateCcw;
  protected readonly PauseIcon   = Pause;
  protected readonly TrashIcon   = Trash2;
  protected readonly RefreshIcon = RefreshCw;

  protected readonly stats             = signal<VpsStats | null>(null);
  protected readonly allContainers     = signal<DockerContainer[]>([]);
  protected readonly health            = signal<HealthCard[]>([
    { label: 'VPS · OVH Paris', status: 'unknown', meta: 'Connexion…' },
    { label: 'API Production',  status: 'unknown', meta: 'Vérification…' },
  ]);
  protected readonly loadingStats      = signal(true);
  protected readonly loadingContainers = signal(true);
  protected readonly lines             = signal<string[]>([]);
  protected readonly paused            = signal(false);
  protected readonly streaming         = signal(false);

  protected readonly logContainers = LOG_CONTAINERS;
  protected selectedContainer = LOG_CONTAINERS[0];
  private es: EventSource | null = null;

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
  protected readonly healthHasDown = computed(() =>
    this.health().some(h => h.status === 'down'),
  );

  constructor() {
    this.startPolling();
  }

  private startPolling(): void {
    // Stats VPS — toutes les 15s, pause si onglet masqué
    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.vpsApi.stats().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => {
      this.loadingStats.set(false);
      if (r) {
        this.stats.set(r.data);
        this.updateHealth('VPS · OVH Paris', 'ok', `Uptime ${this.formatUptime(r.data.uptime)}`);
      } else {
        this.updateHealth('VPS · OVH Paris', 'down', 'SSH inaccessible');
      }
    });

    // Containers — toutes les 15s
    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.vpsApi.containers().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => {
      this.loadingContainers.set(false);
      if (r) this.allContainers.set(r.data ?? []);
    });

    // Santé API prod — toutes les 15s
    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() =>
        this.http.get<{ status: string }>(`${environment.apiUrl}/health`).pipe(
          catchError(() => of(null)),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(r => {
      if (r) {
        this.updateHealth('API Production', 'ok', r.status ?? 'healthy');
      } else {
        this.updateHealth('API Production', 'down', 'Aucune réponse');
      }
    });
  }

  private updateHealth(label: string, status: HealthCard['status'], meta: string): void {
    this.health.update(cards =>
      cards.map(c => c.label === label ? { ...c, status, meta } : c),
    );
  }

  protected refresh(): void {
    this.loadingStats.set(true);
    this.vpsApi.stats().pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe(r => {
        this.loadingStats.set(false);
        if (r) { this.stats.set(r.data); this.updateHealth('VPS · OVH Paris', 'ok', `Uptime ${this.formatUptime(r.data.uptime)}`); }
        else this.updateHealth('VPS · OVH Paris', 'down', 'SSH inaccessible');
      });
    this.vpsApi.containers().pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe(r => { if (r) this.allContainers.set(r.data ?? []); });
  }

  protected containerAction(id: string, act: 'start' | 'stop' | 'restart'): void {
    this.vpsApi.containerAction(id, act)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe();
  }

  protected startStream(): void {
    this.stopStream();
    this.lines.set([]);
    this.streaming.set(true);
    const token = this.auth.getAccessToken() ?? '';
    this.es = new EventSource(this.vpsApi.logsUrl(this.selectedContainer, token));
    this.es.onmessage = (e) => {
      if (this.paused()) return;
      this.lines.update(prev => {
        const next = [...prev, e.data];
        return next.length > 500 ? next.slice(-500) : next;
      });
      requestAnimationFrame(() => {
        if (this.terminalRef?.nativeElement) {
          this.terminalRef.nativeElement.scrollTop = this.terminalRef.nativeElement.scrollHeight;
        }
      });
    };
    this.es.onerror = () => { this.streaming.set(false); this.stopStream(); };
  }

  protected stopStream(): void { this.es?.close(); this.es = null; this.streaming.set(false); }
  protected togglePause(): void { this.paused.update(v => !v); }
  protected clearLines(): void { this.lines.set([]); }

  protected lineClass(line: string): string {
    if (line.includes(' ERR') || line.includes('Error') || line.includes('"error"')) return 'log-error';
    if (line.includes('WARN') || line.includes('"warn"')) return 'log-warn';
    if (line.includes('GET ') || line.includes('POST ') || line.includes('PUT ')) return 'log-req';
    return 'log-info';
  }

  protected formatUptime(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d > 0 ? `${d}j ${h}h` : `${h}h`;
  }

  ngOnDestroy(): void { this.stopStream(); }
}
