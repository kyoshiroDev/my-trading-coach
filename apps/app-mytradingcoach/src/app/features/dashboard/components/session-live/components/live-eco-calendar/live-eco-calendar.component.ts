import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideDynamicIcon,
  LucideCalendarDays as CalendarDays,
  LucideChevronRight as ChevronRight,
} from '@lucide/angular';
import { forkJoin, of, timer } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { EcoCalendarApi, EcoCalendarData, EcoResultAnalysis } from '@app/core/api/eco-calendar.api';
import { TradingSession } from '@app/core/api/session.api';
import { translateEcoEvent } from '@app/core/data/eco-event-translations';

import { EcoSocketService } from '@app/core/services/eco-socket.service';
import { UserStore } from '@app/core/stores/user.store';
import {
  DEMO_ECO_ANALYSIS,
  DEMO_LIVE_ECO_EVENTS,
  ECO_FLAGS,
  currencyToInstruments,
} from './live-eco-calendar.data';
import { eventKey, normalizeEventKey } from '@mtc/shared';
import type { EcoEvent } from '@mtc/shared';

/**
 * Calendrier économique de la session live : événements de la fenêtre de session,
 * alerte temps réel des publications (WebSocket) et analyse IA par événement.
 * La connexion du WebSocket reste pilotée par le parent (état de la session).
 */
@Component({
  selector: 'mtc-live-eco-calendar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon],
  templateUrl: './live-eco-calendar.component.html',
  styleUrl: './live-eco-calendar.component.css',
})
export class LiveEcoCalendarComponent {
  readonly session = input<TradingSession | null>(null);
  readonly ecoCalendar = input<EcoCalendarData | null>(null);
  readonly ecoCalendarRefreshed = output<EcoCalendarData>();

  private readonly destroyRef = inject(DestroyRef);
  private readonly ecoSocket = inject(EcoSocketService);
  private readonly ecoCalendarApi = inject(EcoCalendarApi);
  private readonly userStore = inject(UserStore);

  protected readonly CalIcon = CalendarDays;
  protected readonly ChevronIcon = ChevronRight;

  // Calendrier éco : événement publié déplié au clic (null = tous repliés, style maquette compact)
  protected readonly expandedEcoEvent = signal<string | null>(null);
  protected toggleEcoEvent(name: string): void {
    this.expandedEcoEvent.update((v) => (v === name ? null : name));
  }
  protected impactedInstruments(currency: string | null | undefined): string {
    return currencyToInstruments(currency);
  }

  // Eco results cache
  private readonly ecoResults = signal<Record<string, EcoResultAnalysis>>({});

  // Pins chargés directement depuis l'API : indépendant du cache getTodayEvents
  private readonly freshPins = signal<string[] | null>(null);

  protected readonly pinnedKeys = computed(() => {
    const fresh = this.freshPins();
    const raw = fresh !== null ? fresh : (this.ecoCalendar()?.pinnedEvents ?? []);
    return new Set(raw.map(normalizeEventKey));
  });

  protected readonly sessionEcoEvents = computed(() => {
    const events = (this.ecoCalendar()?.events ?? []).filter((e) => !!e.name?.trim());
    const pinned = this.pinnedKeys();
    const hasMatchingPins = pinned.size > 0 &&
      events.some(e => pinned.has(eventKey(e)));
    if (!hasMatchingPins) return events;
    return events
      .filter(e => pinned.has(eventKey(e)))
      .sort((a, b) => a.time.localeCompare(b.time));
  });

  /** Cap d'affichage : au-delà, on résume par un compteur « +N autres ». */
  private readonly MAX_ECO_EVENTS = 12;

  /** Événements pertinents : contenu réel + fenêtre de session (pas toute la
   *  journée éco, sinon empilement illisible de barres fines).
   *  - publié → seulement si une valeur a été publiée (actual != null), dans les 6 dernières heures
   *  - à venir → heure valide, de −30 min à +6 h autour de maintenant
   *  Triés par heure croissante. */
  protected readonly relevantEcoEvents = computed(() =>
    this.sessionEcoEvents()
      .filter((e) => {
        if (!e.name?.trim()) return false;
        const delta = this.eventMinutesFromNow(e.time);
        if (e.isReleased) {
          if (e.actual == null) return false;
          return delta === null || (delta >= -360 && delta <= 60);
        }
        return delta !== null && delta >= -30 && delta <= 360;
      })
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
  );

  /** Liste effectivement rendue (plafonnée). En démo, exemples figés si rien de réel. */
  protected readonly visibleEcoEvents = computed(() => {
    const real = this.relevantEcoEvents().slice(0, this.MAX_ECO_EVENTS);
    if (real.length > 0) return real;
    return this.userStore.isDemo() ? DEMO_LIVE_ECO_EVENTS : real;
  });

  /** Nombre d'événements pertinents masqués par le cap. */
  protected readonly hiddenEcoCount = computed(() =>
    Math.max(0, this.relevantEcoEvents().length - this.MAX_ECO_EVENTS),
  );

  // Eco WebSocket : nouvelles releases temps réel
  protected readonly newReleases = signal<EcoEvent[]>([]);
  protected readonly showReleaseAlert = signal(false);
  protected readonly releaseAlertState = signal<'analyzing' | 'ready' | 'error'>('analyzing');
  private releaseAlertTimer?: ReturnType<typeof setTimeout>;
  /** Events déjà analysés (dédup du déclenchement au montage). */
  private readonly analyzedNames = new Set<string>();

  constructor() {
    // Démo : analyse IA figée pour les annonces du calendrier (zéro appel modèle).
    if (this.userStore.isDemo()) this.ecoResults.set(DEMO_ECO_ANALYSIS);

    // Pins chargés directement : pas de dépendance au cache getTodayEvents
    this.ecoCalendarApi.getPins()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(res => this.freshPins.set(res.data ?? []));

    // Analyse IA des events DÉJÀ publiés à l'ouverture (session active, hors démo).
    // Limité au FORT impact : ce sont eux qui bougent le marché. Sur une grosse journée
    // (~19 events US), ça évite une rafale d'appels modèle à la 1re ouverture ; le cache
    // mutualisé sert les suivantes. Les releases live restent couvertes par newReleases$.
    effect(() => {
      const s = this.session();
      if (s?.status !== 'ACTIVE' || this.userStore.isDemo()) return;
      const released = this.sessionEcoEvents().filter(
        (e) => e.impact === 'high' && e.isReleased && e.actual != null && !!e.name?.trim(),
      );
      const pending = released.filter((e) => !this.analyzedNames.has(e.name));
      // Échelonné (400 ms) pour ne pas lancer N requêtes simultanées.
      pending.forEach((e, i) => {
        this.analyzedNames.add(e.name);
        timer(i * 400)
          .pipe(
            switchMap(() => this.ecoCalendarApi.analyzeResult(e.name).pipe(catchError(() => of(null)))),
            takeUntilDestroyed(this.destroyRef),
          )
          .subscribe((res) => {
            if (res?.data) this.ecoResults.update((prev) => ({ ...prev, [e.name]: res.data }));
          });
      });
    });

    // Écouter les nouvelles releases
    this.ecoSocket.newReleases$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => {
        this.newReleases.set(events);
        this.releaseAlertState.set('analyzing');
        this.showReleaseAlert.set(true);
        clearTimeout(this.releaseAlertTimer);

        // Re-synchroniser le calendrier (actual values) pour le parent
        this.ecoCalendarApi.refreshAnalysis()
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((res) => this.ecoCalendarRefreshed.emit(res.data));

        // Analyse IA ciblée par événement publié
        const calls = events.map((ev) =>
          this.ecoCalendarApi.analyzeResult(ev.name).pipe(
            map((res) => ({ name: ev.name, analysis: res.data })),
            catchError(() => of({ name: ev.name, analysis: null as EcoResultAnalysis | null })),
          ),
        );
        if (!calls.length) { this.showReleaseAlert.set(false); return; }

        forkJoin(calls)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((results) => {
            const next = { ...this.ecoResults() };
            let anyOk = false;
            for (const r of results) {
              if (r.analysis) { next[r.name] = r.analysis; anyOk = true; }
            }
            this.ecoResults.set(next);
            this.releaseAlertState.set(anyOk ? 'ready' : 'error');
            // auto-dismiss UNIQUEMENT une fois l'analyse arrivée
            this.releaseAlertTimer = setTimeout(() => this.showReleaseAlert.set(false), 12000);
          });
      });

    this.destroyRef.onDestroy(() => clearTimeout(this.releaseAlertTimer));
  }

  protected isOutsideSession(time: string): boolean {
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    return h >= 16;
  }

  protected formatTime(iso: string): string {
    if (!iso) return '-';
    if (iso.includes('T')) {
      const d = new Date(iso);
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return iso.slice(0, 5);
  }

  protected minutesUntil(time: string): number {
    const now = new Date();
    const h = parseInt(time.split(':')[0] ?? '0', 10);
    const min = parseInt(time.split(':')[1] ?? '0', 10);
    const eventMin = h * 60 + min;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return Math.max(0, eventMin - nowMin);
  }

  /** Minutes signées entre l'événement et maintenant (négatif = passé).
   *  Gère le format « HH:MM » comme l'ISO. null si l'heure est invalide. */
  private eventMinutesFromNow(time: string | null | undefined): number | null {
    if (!time) return null;
    let h: number, m: number;
    if (time.includes('T')) {
      const d = new Date(time);
      h = d.getHours();
      m = d.getMinutes();
    } else {
      h = parseInt(time.split(':')[0] ?? '', 10);
      m = parseInt(time.split(':')[1] ?? '0', 10);
    }
    if (!Number.isFinite(h)) return null;
    const now = new Date();
    return h * 60 + (Number.isFinite(m) ? m : 0) - (now.getHours() * 60 + now.getMinutes());
  }

  protected getEventAnalysis(eventName: string): EcoResultAnalysis | null {
    return this.ecoResults()[eventName] ?? null;
  }

  protected translate(name: string): string {
    return translateEcoEvent(name);
  }

  protected getFlag(event: { country?: string | null; currency?: string | null }): string {
    if (event.country) {
      const flag = ECO_FLAGS[event.country.toUpperCase()];
      if (flag) return flag;
    }
    return ECO_FLAGS[event.currency?.toUpperCase() ?? ''] ?? '🌐';
  }
}
