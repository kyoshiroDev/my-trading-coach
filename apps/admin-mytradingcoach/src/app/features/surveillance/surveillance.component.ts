import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  OnDestroy, computed, inject, signal, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, filter, interval, of, startWith, switchMap } from 'rxjs';
import { LucideAngularModule, Play, Pause, Trash2, RefreshCw } from 'lucide-angular';
import { VpsApi, VpsStats, DockerContainer, HealthPoint } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';

type DockerAction = 'start' | 'stop' | 'restart';
interface CtAction { icon: string; label: string; action: DockerAction; danger?: boolean; }
interface ConfirmState { id: string; name: string; action: DockerAction; }

const GB = 1_073_741_824;

@Component({
  selector: 'mtc-admin-surveillance',
  standalone: true,
  imports: [DecimalPipe, LucideAngularModule],
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

      <!-- ── 4 KPI (tous issus de /vps/stats — aucune valeur inventée) ── -->
      <div class="kpi-strip cols-4">
        @if (stats(); as s) {
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">CPU VPS</div><div class="kpi-value teal">{{ s.cpu }}%</div><div class="kpi-sub">charge processeur</div></div>
          <div class="kpi"><div class="kpi-top blue"></div><div class="kpi-label">RAM</div><div class="kpi-value blue">{{ ramPct() }}%</div><div class="kpi-sub">{{ gb(s.ram.used) }} / {{ gb(s.ram.total) }}G</div></div>
          <div class="kpi"><div class="kpi-top amber"></div><div class="kpi-label">Disque</div><div class="kpi-value amber">{{ diskPct() }}%</div><div class="kpi-sub">{{ gb(s.disk.used) }} / {{ gb(s.disk.total) }}G</div></div>
          <div class="kpi"><div class="kpi-top purple"></div><div class="kpi-label">Uptime VPS</div><div class="kpi-value purple">{{ formatUptime(s.uptime) }}</div><div class="kpi-sub">en ligne</div></div>
        } @else {
          <div class="kpi"><div class="kpi-top teal"></div><div class="kpi-label">VPS</div><div class="kpi-value">{{ loadingStats() ? '…' : 'n/d' }}</div><div class="kpi-sub">{{ loadingStats() ? 'connexion SSH…' : 'indisponible' }}</div></div>
        }
      </div>

      <!-- ── g2 : containers | (ressources + uptime) ── -->
      <div class="surv-main">
        <!-- Gauche : containers Docker (liste dynamique, vraies stats) -->
        <div class="card surv-ct">
          <div class="card-head">
            <span class="card-label">Containers Docker</span>
            <span class="badge b-ok">{{ runningCount() }} running</span>
          </div>
          <div class="card-body">
            @if (loadingContainers() && allContainers().length === 0) {
              <div class="empty">Connexion au VPS…</div>
            } @else if (allContainers().length === 0) {
              <div class="empty">Aucun container (VPS injoignable)</div>
            } @else {
              @for (c of allContainers(); track c.id) {
                <div class="ct-row">
                  <span class="st" [class.down]="c.status !== 'running'"></span>
                  <span class="ct-name">{{ c.name }}</span>
                  <span class="ct-meta">
                    <span class="ct-img">{{ c.image }}</span>
                    @if (c.status === 'running') {
                      <span [class.warn]="c.cpu > 50">{{ c.cpu | number:'1.1-1' }}%</span>
                      <span>{{ c.ram | number:'1.0-0' }} MB</span>
                    } @else {
                      <span class="meta-down">{{ c.status === 'error' ? '⚠ erreur' : '⏸ arrêté' }}</span>
                    }
                  </span>
                  <span class="ct-acts">
                    <button class="pill" title="Voir les logs" (click)="openLogs(c.name)">📋</button>
                    @for (a of actionsFor(c); track a.action) {
                      <button class="pill" [class.danger]="a.danger" [title]="a.label" (click)="askConfirm(c, a.action)">{{ a.icon }}</button>
                    }
                  </span>
                </div>
              }
            }
          </div>
        </div>

        <!-- Droite : ressources VPS + uptime 90 jours -->
        <div class="surv-side">
          <div class="card surv-res">
            <div class="card-head"><span class="card-label">Ressources VPS</span></div>
            <div class="card-body">
              @if (stats(); as s) {
                <div class="gauge"><span class="gauge-name">CPU</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="s.cpu" [style.background]="cpuColor()"></div></div><span class="gauge-val">{{ s.cpu }}%</span></div>
                <div class="gauge"><span class="gauge-name">RAM</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="ramPct()" [style.background]="threshold(ramPct())"></div></div><span class="gauge-val">{{ gb(s.ram.used) }} / {{ gb(s.ram.total) }}G</span></div>
                <div class="gauge"><span class="gauge-name">Disque</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="diskPct()" [style.background]="threshold(diskPct())"></div></div><span class="gauge-val">{{ gb(s.disk.used) }} / {{ gb(s.disk.total) }}G</span></div>
                <div class="gauge"><span class="gauge-name">Réseau ↑</span><div class="gauge-track"><div class="gauge-fill" [style.width.%]="netWidth()" style="background:var(--purple)"></div></div><span class="gauge-val">{{ (s.network.up/1024) | number:'1.0-0' }} KB/s</span></div>
              } @else {
                <div class="empty">{{ loadingStats() ? 'Connexion SSH…' : 'VPS non disponible' }}</div>
              }
            </div>
          </div>

          <div class="card">
            <div class="card-head"><span class="card-label">Uptime 90 jours</span></div>
            <div class="card-body">
              <div class="uptime-bars">
                @for (h of health(); track h.date) {
                  <span class="ub" [class.ok]="h.status==='ok'" [class.incident]="h.status==='incident'" [class.unknown]="h.status==='unknown'" [title]="h.date + ' · ' + h.status"></span>
                }
              </div>
              <div class="uptime-legend">
                <span><i class="ub-dot ok"></i> OK</span>
                <span><i class="ub-dot incident"></i> Incident</span>
                <span><i class="ub-dot maint"></i> Maintenance</span>
              </div>
              @if (allUnknown()) {
                <div class="uptime-note">Pas encore de données — le suivi de santé démarre au prochain relevé quotidien.</div>
              }
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Modale de confirmation (actions PROD) ── -->
    @if (confirmState(); as cf) {
      <div class="modal-overlay" role="button" tabindex="-1" (click)="confirmState.set(null)" (keydown.escape)="confirmState.set(null)">
        <div class="modal" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="modal-head"><h3 class="modal-title">⚠️ Action en PRODUCTION</h3><button class="modal-x" (click)="confirmState.set(null)">✕</button></div>
          <div class="modal-body">
            <p class="confirm-text">Tu vas <strong>{{ actionLabel(cf.action) }}</strong> le container <strong>{{ cf.name }}</strong> en <strong class="text-red">PRODUCTION</strong>. Confirmer ?</p>
          </div>
          <div class="modal-foot">
            <button class="btn-ghost" (click)="confirmState.set(null)">Annuler</button>
            <button class="btn-danger" [disabled]="acting()" (click)="runConfirmed()">{{ acting() ? '…' : actionLabel(cf.action) }}</button>
          </div>
        </div>
      </div>
    }

    <!-- ── Drawer logs (lecture seule) ── -->
    @if (logsContainer(); as lc) {
      <div class="drawer-overlay" role="button" tabindex="-1" (click)="closeLogs()" (keydown.escape)="closeLogs()">
        <div class="drawer" role="dialog" aria-modal="true" (click)="$event.stopPropagation()" (keydown)="$event.stopPropagation()">
          <div class="drawer-head">
            <span class="card-label">Logs · {{ lc }}</span>
            <div class="drawer-acts">
              <button class="icon-btn" (click)="togglePause()" [title]="paused() ? 'Reprendre' : 'Pause'"><lucide-icon [img]="paused() ? PlayIcon : PauseIcon" [size]="12" /></button>
              <button class="icon-btn" (click)="clearLines()" title="Vider"><lucide-icon [img]="TrashIcon" [size]="12" /></button>
              <button class="modal-x" (click)="closeLogs()">✕</button>
            </div>
          </div>
          <div class="log-terminal" #terminal>
            @for (line of lines(); track $index) { <div class="log-line" [class]="lineClass(line)">{{ line }}</div> }
            @if (lines().length === 0) { <div class="log-empty">En attente de logs…</div> }
          </div>
        </div>
      </div>
    }
  `,
})
export class SurveillanceComponent implements OnDestroy {
  private readonly vpsApi = inject(VpsApi);
  private readonly auth = inject(AdminAuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly terminalRef = viewChild<ElementRef<HTMLDivElement>>('terminal');

  protected readonly PlayIcon = Play;
  protected readonly PauseIcon = Pause;
  protected readonly TrashIcon = Trash2;
  protected readonly RefreshIcon = RefreshCw;

  protected readonly stats = signal<VpsStats | null>(null);
  protected readonly allContainers = signal<DockerContainer[]>([]);
  protected readonly health = signal<HealthPoint[]>([]);
  protected readonly loadingStats = signal(true);
  protected readonly loadingContainers = signal(true);

  // Confirmation + drawer logs
  protected readonly confirmState = signal<ConfirmState | null>(null);
  protected readonly acting = signal(false);
  protected readonly logsContainer = signal<string | null>(null);
  protected readonly lines = signal<string[]>([]);
  protected readonly paused = signal(false);
  private es: EventSource | null = null;

  protected readonly runningCount = computed(() => this.allContainers().filter((c) => c.status === 'running').length);
  protected readonly ramPct = computed(() => this.pct(this.stats()?.ram));
  protected readonly diskPct = computed(() => this.pct(this.stats()?.disk));
  protected readonly netWidth = computed(() => Math.min(100, (this.stats()?.network.up ?? 0) / 1024 / 30));
  protected readonly cpuColor = computed(() => this.threshold(this.stats()?.cpu ?? 0));
  protected readonly allUnknown = computed(() => this.health().length > 0 && this.health().every((h) => h.status === 'unknown'));

  constructor() {
    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.vpsApi.stats().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { this.loadingStats.set(false); if (r) this.stats.set(r.data); });

    interval(15_000).pipe(
      startWith(0),
      filter(() => document.visibilityState === 'visible'),
      switchMap(() => this.vpsApi.containers().pipe(catchError(() => of(null)))),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((r) => { this.loadingContainers.set(false); if (r) this.allContainers.set(r.data ?? []); });

    this.vpsApi.healthHistory(90).pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => { if (r) this.health.set(r.data ?? []); });
  }

  protected refresh(): void {
    this.loadingStats.set(true);
    this.vpsApi.stats().pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe((r) => { this.loadingStats.set(false); if (r) this.stats.set(r.data); });
    this.vpsApi.containers().pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe((r) => { if (r) this.allContainers.set(r.data ?? []); });
  }

  // ── Actions par type de container (logs toujours dispo, rendu à part) ──────
  protected actionsFor(c: DockerContainer): CtAction[] {
    const n = c.name.toLowerCase();
    // DB & proxy : on ne propose pas le "stop" en un geste (trop critique), juste redémarrer.
    if (n.includes('postgres') || n.includes('pgbouncer') || n.includes('redis') || n.includes('traefik')) {
      return [{ icon: '↻', label: 'Redémarrer', action: 'restart' }];
    }
    return [
      { icon: '↻', label: 'Redémarrer', action: 'restart' },
      { icon: '⏹', label: 'Arrêter', action: 'stop', danger: true },
    ];
  }

  protected askConfirm(c: DockerContainer, action: DockerAction): void {
    this.confirmState.set({ id: c.id, name: c.name, action });
  }

  protected actionLabel(a: DockerAction): string {
    return a === 'restart' ? 'redémarrer' : a === 'stop' ? 'arrêter' : 'démarrer';
  }

  protected runConfirmed(): void {
    const cf = this.confirmState();
    if (!cf) return;
    this.acting.set(true);
    this.vpsApi.containerAction(cf.id, cf.action)
      .pipe(takeUntilDestroyed(this.destroyRef), catchError(() => of(null)))
      .subscribe(() => {
        this.acting.set(false);
        this.confirmState.set(null);
        this.refresh();
      });
  }

  // ── Drawer logs (SSE, lecture seule) ───────────────────────────────────────
  protected openLogs(container: string): void {
    this.logsContainer.set(container);
    this.startStream(container);
  }
  protected closeLogs(): void {
    this.stopStream();
    this.logsContainer.set(null);
    this.lines.set([]);
  }
  private startStream(container: string): void {
    this.stopStream();
    this.lines.set([]);
    this.paused.set(false);
    const token = this.auth.getAccessToken() ?? '';
    this.es = new EventSource(this.vpsApi.logsUrl(container, token));
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
    this.es.onerror = () => this.stopStream();
  }
  private stopStream(): void { this.es?.close(); this.es = null; }
  protected togglePause(): void { this.paused.update((v) => !v); }
  protected clearLines(): void { this.lines.set([]); }
  protected lineClass(line: string): string {
    if (line.includes(' ERR') || line.includes('Error') || line.includes('"error"')) return 'log-error';
    if (line.includes('WARN') || line.includes('"warn"')) return 'log-warn';
    if (line.includes('GET ') || line.includes('POST ') || line.includes('PUT ')) return 'log-req';
    return 'log-info';
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  private pct(u?: { used: number; total: number }): number {
    if (!u || !u.total) return 0;
    return Math.round((u.used / u.total) * 100);
  }
  protected threshold(pct: number): string {
    return pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--amber)' : 'var(--teal)';
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
