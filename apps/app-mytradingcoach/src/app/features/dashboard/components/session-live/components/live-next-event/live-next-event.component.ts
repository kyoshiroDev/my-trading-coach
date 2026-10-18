import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, interval, map, of } from 'rxjs';
import type { EcoEvent } from '@mtc/shared';
import { EcoCalendarApi, EcoCalendarData, EcoResultAnalysis } from '@app/core/api/eco-calendar.api';
import { translateEcoEvent } from '@app/core/data/eco-event-translations';
import { EcoSocketService } from '@app/core/services/eco-socket.service';
import { cmeReopenLabel, countdownLabel, nextAnnouncement, releaseExpired, splitFirstSentence } from '../../session-live.util';

/** Annonce qui vient de tomber, avec l'analyse IA existante (null tant qu'elle n'est pas arrivée). */
interface Release {
  event: EcoEvent;
  analysis: EcoResultAnalysis | null;
  state: 'analyzing' | 'ready' | 'error';
  shownAt: number;
}

/**
 * « Prochaine annonce » de la session live v3 : une ligne, compte à rebours recalculé chaque
 * minute. Plus d'annonce aujourd'hui → rien (pas d'état vide). Le calendrier complet reste dans
 * la Pré-session.
 *
 * Marché fermé (week-end CME) : la ligne le dit, avec l'heure de réouverture.
 *
 * Quand une annonce tombe (WebSocket éco `eco:new-releases`), la ligne passe à l'état « publiée » :
 * chiffre publié et prévision, première phrase de l'analyse IA (le reste se déplie). Mêmes appels
 * que l'ancien calendrier live : relecture du calendrier pour le parent, puis `analyze-result` par
 * annonce publiée — aucun appel de plus. Retour à l'annonce suivante une fois lue ou après 15 min.
 */
@Component({
  selector: 'mtc-live-next-event',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './live-next-event.component.css',
  templateUrl: './live-next-event.component.html',
})
export class LiveNextEventComponent {
  readonly events = input<EcoEvent[]>([]);
  /** Calendrier relu après une publication (valeurs publiées) : le parent le remonte au store. */
  readonly ecoCalendarRefreshed = output<EcoCalendarData>();

  private readonly ecoApi = inject(EcoCalendarApi);
  private readonly destroyRef = inject(DestroyRef);

  private readonly now = signal(new Date());
  protected readonly next = computed(() => nextAnnouncement(this.events(), this.now()));
  /** Marché CME fermé (week-end) : « réouverture dimanche 23:00 » à la place de l'annonce. */
  protected readonly reopen = computed(() => cmeReopenLabel(this.now()));
  protected readonly releases = signal<Release[]>([]);
  protected readonly release = computed(() => this.releases()[0] ?? null);
  protected readonly expanded = signal(false);
  protected readonly summary = computed(() => {
    const a = this.release()?.analysis;
    return a ? splitFirstSentence(a.interpretation) : null;
  });

  protected readonly countdown = countdownLabel;
  protected readonly name = translateEcoEvent;

  constructor() {
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.now.set(new Date());
        // Annonce publiée affichée depuis 15 min : on passe à la suivante.
        this.releases.update((list) => list.filter((r) => !releaseExpired(r.shownAt, Date.now())));
      });

    inject(EcoSocketService).newReleases$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((events) => this.onReleases(events));
  }

  private onReleases(events: EcoEvent[]): void {
    const fresh = events.filter((e) => !!e.name?.trim());
    if (!fresh.length) return;
    const shownAt = Date.now();
    this.releases.update((list) => [
      ...fresh.map((event) => ({ event, analysis: null, state: 'analyzing' as const, shownAt })),
      ...list.filter((r) => !fresh.some((e) => e.name === r.event.name)),
    ]);
    this.expanded.set(false);

    // Re-synchroniser le calendrier (valeurs publiées) pour le parent
    this.ecoApi.refreshAnalysis()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((res) => { if (res) this.ecoCalendarRefreshed.emit(res.data); });

    // Analyse IA ciblée par événement publié
    forkJoin(fresh.map((ev) =>
      this.ecoApi.analyzeResult(ev.name).pipe(
        map((res) => ({ name: ev.name, analysis: res.data as EcoResultAnalysis | null })),
        catchError(() => of({ name: ev.name, analysis: null as EcoResultAnalysis | null })),
      ),
    ))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => this.releases.update((list) => list.map((r) => {
        const hit = results.find((x) => x.name === r.event.name);
        return hit ? { ...r, analysis: hit.analysis, state: hit.analysis ? 'ready' : 'error' } : r;
      })));
  }

  /** « J'ai lu » : l'annonce publiée laisse la place à la suivante. */
  protected dismiss(): void {
    this.releases.update((list) => list.slice(1));
    this.expanded.set(false);
  }

  protected time(t: string): string {
    if (!t) return '';
    return t.includes('T')
      ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : t.slice(0, 5);
  }

  protected value(v: number | null, unit?: string | null): string {
    return v === null || v === undefined ? '-' : `${v.toLocaleString('fr-FR')}${unit ?? ''}`;
  }
}
