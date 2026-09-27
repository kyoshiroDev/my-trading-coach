import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef,
  OnDestroy, computed, inject, signal, viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, filter, interval, of, startWith, switchMap } from 'rxjs';
import {
  LucideDynamicIcon,
  LucidePlay as Play,
  LucidePause as Pause,
  LucideTrash2 as Trash2,
  LucideRefreshCw as RefreshCw,
} from '@lucide/angular';
import { VpsApi, VpsStats, DockerContainer, HealthPoint } from '../../core/api/vps.api';
import { AdminAuthService } from '../../core/auth/admin-auth.service';
import { DialogDirective } from '@mtc/front-ui';

type DockerAction = 'start' | 'stop' | 'restart';
interface CtAction { icon: string; label: string; action: DockerAction; danger?: boolean; }
interface ConfirmState { id: string; name: string; action: DockerAction; }

const GB = 1_073_741_824;

@Component({
  selector: 'mtc-admin-monitoring',
  imports: [DialogDirective, DecimalPipe, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './monitoring.component.css',
  templateUrl: './monitoring.component.html',
})
export class MonitoringComponent implements OnDestroy {
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
