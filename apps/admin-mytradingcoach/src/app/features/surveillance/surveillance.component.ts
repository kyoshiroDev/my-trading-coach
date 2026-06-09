import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  OnDestroy, computed, inject, signal, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, filter, interval, of, startWith, switchMap } from 'rxjs';
import type { ChartConfiguration, ScriptableContext } from 'chart.js';
import { LucideAngularModule, Play, Square, RotateCcw, Pause, Trash2, RefreshCw } from 'lucide-angular';
import { VpsApi, VpsStats, DockerContainer } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { environment } from '../../../environments/environment';
import { ChartCanvasComponent } from '../../shared/components/chart-canvas/chart-canvas.component';
import { CHART_COLORS, fade, noLegend } from '../../shared/charts/chart-theme';

interface HealthCard { label: string; status: 'ok' | 'down' | 'unknown'; meta: string; }
interface ContainerGroup { label: string; tone: string; containers: DockerContainer[]; }

const GB = 1_073_741_824;
const CPU_HISTORY_LEN = 30;
const LOG_CONTAINERS = ['mtc_api_prod', 'mtc_api_dev', 'mtc_postgres', 'mtc_redis', 'mtc_pgbouncer', 'mtc_traefik'];

@Component({
  selector: 'mtc-admin-surveillance',
  standalone: true,
  imports: [DecimalPipe, FormsModule, LucideAngularModule, ChartCanvasComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './surveillance.component.css',
  template: `
    <div class="screen">
      <div class="page-head">
        <div class="page-title">Surveillance</div>
        <button class="refresh-tag refresh-btn" (click)="refresh()" [disabled]="loadingStats()" aria-label="Forcer le refresh">
          <lucide-icon [img]="RefreshIcon" [size]="12" /> 15s ⟳
        </button>
      </div>

      <!-- ── Cartes statut ── -->
      <div class="grid-2">
        @for (h of health(); track h.label) {
          <div class="card"><div class="card-body status-card">
            <span class="ct-dot" [class.green]="h.status==='ok'" [class.amber]="h.status==='unknown'" [class.down]="h.status==='down'"></span>
            <div><div class="status-name">{{ h.label }}</div><div class="page-meta">{{ h.meta }}</div></div>
            <span class="badge" [class.b-ok]="h.status==='ok'" [class.b-free]="h.status!=='ok'">{{ h.status==='ok' ? 'OK' : h.status==='down' ? 'DOWN' : '…' }}</span>
          </div></div>
        }
      </div>

      <!-- ── Ressources + Infos | Containers ── -->
      <div class="surv-main">
        <div class="surv-left">
          <div class="card surv-res">
            <div class="card-head"><span class="card-label">Ressources système</span>
              @if (loadingStats()) { <span class="refresh-tag">chargement…</span> }</div>
            <div class="card-body">
              @if (stats(); as s) {
                <div class="gauge"><span class="gauge-name">CPU</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="s.cpu" [style.background]="cpuColor()"></div></div><span class="gauge-val">{{ s.cpu }}%</span></div>
                <div class="gauge"><span class="gauge-name">RAM</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="ramPct()" style="background:var(--blue)"></div></div><span class="gauge-val">{{ gb(s.ram.used) }} / {{ gb(s.ram.total) }}G</span></div>
                <div class="gauge"><span class="gauge-name">Disque</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="diskPct()" [style.background]="diskPct() > 85 ? 'var(--red)' : 'var(--amber)'"></div></div><span class="gauge-val">{{ gb(s.disk.used) }} / {{ gb(s.disk.total) }}G</span></div>
                <div class="gauge"><span class="gauge-name">Réseau ↑</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="netWidth()" style="background:var(--purple)"></div></div><span class="gauge-val">{{ (s.network.up/1024) | number:'1.0-0' }} KB/s</span></div>
                <div class="cpu-spark"><div class="card-label cpu-spark-label">CPU (60s)</div><div class="chart-box cpu-spark-box"><mtc-chart [config]="cpuSparkConfig()" /></div></div>
              } @else {
                <div class="empty">{{ loadingStats() ? 'Connexion SSH…' : 'VPS non disponible' }}</div>
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head"><span class="card-label">Informations</span></div>
            <div class="card-body">
              @if (stats(); as s) {
                <div class="info-row"><span class="info-k">IP</span><span class="info-v">{{ s.ip }}</span></div>
                <div class="info-row"><span class="info-k">OS</span><span class="info-v">{{ s.os }}</span></div>
                <div class="info-row"><span class="info-k">Kernel</span><span class="info-v">{{ s.kernel }}</span></div>
                <div class="info-row"><span class="info-k">Docker</span><span class="info-v">{{ s.docker }}</span></div>
                <div class="info-row"><span class="info-k">Uptime</span><span class="info-v">{{ formatUptime(s.uptime) }}</span></div>
              } @else { <div class="empty">—</div> }
            </div>
          </div>
        </div>

        <div class="card surv-ct">
          <div class="card-head"><span class="card-label">Containers Docker</span>
            <span class="badge b-ok">{{ runningCount() }} running</span></div>
          <div class="card-body">
            @if (loadingContainers() && allContainers().length === 0) {
              <div class="empty">Connexion au VPS…</div>
            } @else {
              @for (group of groups(); track group.label) {
                @if (group.containers.length) {
                  <div class="ct-group">
                    <div class="ct-group-label"><span class="ct-dot" [class]="group.tone"></span>{{ group.label }} · {{ group.containers.length }}</div>
                    @for (c of group.containers; track c.id) {
                      <div class="ct-row">
                        <span class="st" [class.down]="c.status !== 'running'"></span>
                        <span class="ct-name">{{ c.name }}</span>
                        <span class="ct-meta">
                          <span>{{ c.image }}</span>
                          @if (c.status === 'running') {
                            <span [class.warn]="c.cpu > 50">{{ c.cpu | number:'1.1-1' }}%</span>
                            <span>{{ c.ram }}MB</span>
                          } @else {
                            <span class="meta-down">{{ c.status === 'error' ? '⚠ erreur' : '⏸ arrêté' }}</span>
                          }
                        </span>
                        <span class="ct-actions">
                          @if (c.status !== 'running') {
                            <button class="icon-btn" title="Démarrer" (click)="containerAction(c.name, 'start')"><lucide-icon [img]="PlayIcon" [size]="11" /></button>
                          } @else {
                            <button class="icon-btn" title="Arrêter" (click)="containerAction(c.name, 'stop')"><lucide-icon [img]="StopIcon" [size]="11" /></button>
                          }
                          <button class="icon-btn" title="Redémarrer" (click)="containerAction(c.name, 'restart')"><lucide-icon [img]="RestartIcon" [size]="11" /></button>
                        </span>
                      </div>
                    }
                  </div>
                }
              }
            }
          </div>
        </div>
      </div>

      <!-- ── Logs live ── -->
      <div class="card logs-card">
        <div class="card-head">
          <span class="card-label">Logs live</span>
          <div class="log-controls">
            <select class="log-select" [(ngModel)]="selectedContainer" aria-label="Container">
              @for (c of logContainers; track c) { <option [value]="c">{{ c }}</option> }
            </select>
            @if (!streaming()) {
              <button class="btn-launch" (click)="startStream()"><lucide-icon [img]="PlayIcon" [size]="11" /> Lancer</button>
            } @else {
              <button class="icon-btn" (click)="togglePause()" [title]="paused() ? 'Reprendre' : 'Pause'"><lucide-icon [img]="paused() ? PlayIcon : PauseIcon" [size]="11" /></button>
              <button class="icon-btn" (click)="stopStream()" title="Arrêter"><lucide-icon [img]="StopIcon" [size]="11" /></button>
              <button class="icon-btn" (click)="clearLines()" title="Vider"><lucide-icon [img]="TrashIcon" [size]="11" /></button>
            }
          </div>
        </div>
        <div class="log-terminal" #terminal>
          @for (line of lines(); track $index) {
            <div class="log-line" [class]="lineClass(line)">{{ line }}</div>
          }
          @if (!streaming()) {
            <div class="log-empty">Sélectionne un container et clique sur « Lancer »</div>
          } @else if (lines().length === 0) {
            <div class="log-empty">En attente de logs…</div>
          }
        </div>
      </div>
    </div>
  `,
})
export class SurveillanceComponent implements OnDestroy {
  private readonly vpsApi = inject(VpsApi);
  private readonly auth = inject(AdminAuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly terminalRef = viewChild<ElementRef<HTMLDivElement>>('terminal');

  protected readonly PlayIcon = Play;
  protected readonly StopIcon = Square;
  protected readonly RestartIcon = RotateCcw;
  protected readonly PauseIcon = Pause;
  protected readonly TrashIcon = Trash2;
  protected readonly RefreshIcon = RefreshCw;

  protected readonly stats = signal<VpsStats | null>(null);
  protected readonly allContainers = signal<DockerContainer[]>([]);
  protected readonly cpuHistory = signal<number[]>([]);
  protected readonly health = signal<HealthCard[]>([
    { label: 'VPS · OVH Paris', status: 'unknown', meta: 'Connexion…' },
    { label: 'API Production', status: 'unknown', meta: 'Vérification…' },
  ]);
  protected readonly loadingStats = signal(true);
  protected readonly loadingContainers = signal(true);

  // ── Logs live ──
  protected readonly lines = signal<string[]>([]);
  protected readonly paused = signal(false);
  protected readonly streaming = signal(false);
  protected readonly logContainers = LOG_CONTAINERS;
  protected selectedContainer = LOG_CONTAINERS[0];
  private es: EventSource | null = null;

  protected readonly runningCount = computed(() => this.allContainers().filter((c) => c.status === 'running').length);
  protected readonly groups = computed((): ContainerGroup[] => {
    const all = this.allContainers();
    return [
      { label: 'PRODUCTION', tone: 'green', containers: all.filter((c) => c.name.includes('_prod') || c.name.includes('discord')) },
      { label: 'DÉVELOPPEMENT', tone: 'blue', containers: all.filter((c) => c.name.includes('_dev')) },
      { label: 'INFRASTRUCTURE', tone: 'amber', containers: all.filter((c) => !c.name.includes('_prod') && !c.name.includes('_dev') && !c.name.includes('discord')) },
    ];
  });

  protected readonly ramPct = computed(() => this.pct(this.stats()?.ram));
  protected readonly diskPct = computed(() => this.pct(this.stats()?.disk));
  protected readonly netWidth = computed(() => Math.min(100, (this.stats()?.network.up ?? 0) / 1024 / 30));
  protected readonly cpuColor = computed(() => {
    const c = this.stats()?.cpu ?? 0;
    return c > 80 ? 'var(--red)' : c > 60 ? 'var(--amber)' : 'var(--teal)';
  });

  protected readonly cpuSparkConfig = computed<ChartConfiguration>(() => ({
    type: 'line',
    data: {
      labels: this.cpuHistory().map((_, i) => i),
      datasets: [
        {
          data: this.cpuHistory(),
          borderColor: CHART_COLORS.teal,
          backgroundColor: (ctx: ScriptableContext<'line'>) => fade(ctx, CHART_COLORS.teal),
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: noLegend,
      scales: { x: { display: false }, y: { display: false, beginAtZero: true, suggestedMax: 100 } },
    },
  } as ChartConfiguration));

  constructor() {
    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.vpsApi.stats().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      this.loadingStats.set(false);
      if (r) {
        this.stats.set(r.data);
        this.cpuHistory.update((h) => [...h, r.data.cpu].slice(-CPU_HISTORY_LEN));
        this.updateHealth('VPS · OVH Paris', 'ok', `Uptime ${this.formatUptime(r.data.uptime)}`);
      } else {
        this.updateHealth('VPS · OVH Paris', 'down', 'SSH inaccessible');
      }
    });

    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.vpsApi.containers().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => {
      this.loadingContainers.set(false);
      if (r) this.allContainers.set(r.data ?? []);
    });

    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.http.get<{ status: string }>(`${environment.apiUrl}/health`).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => this.updateHealth('API Production', r ? 'ok' : 'down', r ? (r.status ?? 'healthy') : 'Aucune réponse'));
  }

  protected refresh(): void {
    this.loadingStats.set(true);
    this.vpsApi.stats().pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe((r) => {
        this.loadingStats.set(false);
        if (r) { this.stats.set(r.data); this.cpuHistory.update((h) => [...h, r.data.cpu].slice(-CPU_HISTORY_LEN)); this.updateHealth('VPS · OVH Paris', 'ok', `Uptime ${this.formatUptime(r.data.uptime)}`); }
        else this.updateHealth('VPS · OVH Paris', 'down', 'SSH inaccessible');
      });
    this.vpsApi.containers().pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe((r) => { if (r) this.allContainers.set(r.data ?? []); });
  }

  protected containerAction(id: string, act: 'start' | 'stop' | 'restart'): void {
    this.vpsApi.containerAction(id, act).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
  }

  // ── Logs live (SSE) ──────────────────────────────────────────────────────
  protected startStream(): void {
    this.stopStream();
    this.lines.set([]);
    this.streaming.set(true);
    const token = this.auth.getAccessToken() ?? '';
    this.es = new EventSource(this.vpsApi.logsUrl(this.selectedContainer, token));
    this.es.onmessage = (e) => {
      if (this.paused()) return;
      this.lines.update((prev) => {
        const next = [...prev, e.data];
        return next.length > 500 ? next.slice(-500) : next;
      });
      requestAnimationFrame(() => {
        const el = this.terminalRef()?.nativeElement;
        if (el) el.scrollTop = el.scrollHeight;
      });
    };
    this.es.onerror = () => { this.streaming.set(false); this.stopStream(); };
  }

  protected stopStream(): void { this.es?.close(); this.es = null; this.streaming.set(false); }
  protected togglePause(): void { this.paused.update((v) => !v); }
  protected clearLines(): void { this.lines.set([]); }

  protected lineClass(line: string): string {
    if (line.includes(' ERR') || line.includes('Error') || line.includes('"error"')) return 'log-error';
    if (line.includes('WARN') || line.includes('"warn"')) return 'log-warn';
    if (line.includes('GET ') || line.includes('POST ') || line.includes('PUT ')) return 'log-req';
    return 'log-info';
  }

  private updateHealth(label: string, status: HealthCard['status'], meta: string): void {
    this.health.update((cards) => cards.map((c) => (c.label === label ? { ...c, status, meta } : c)));
  }

  private pct(u?: { used: number; total: number }): number {
    if (!u || !u.total) return 0;
    return Math.round((u.used / u.total) * 100);
  }
  protected gb(bytes: number): string {
    const g = bytes / GB;
    return g >= 10 ? Math.round(g).toString() : (Math.round(g * 10) / 10).toString();
  }
  protected formatUptime(s: number): string {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    return d > 0 ? `${d}j ${h}h` : `${h}h`;
  }

  ngOnDestroy(): void { this.stopStream(); }
}
