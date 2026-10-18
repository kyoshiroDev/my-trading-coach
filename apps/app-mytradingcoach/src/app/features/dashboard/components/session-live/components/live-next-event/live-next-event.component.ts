import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, interval, map, of } from 'rxjs';
import type { EcoEvent } from '@mtc/shared';
import { EcoCalendarApi, EcoCalendarData, EcoResultAnalysis } from '@app/core/api/eco-calendar.api';
import { translateEcoEvent } from '@app/core/data/eco-event-translations';
import { EcoSocketService } from '@app/core/services/eco-socket.service';
import { byImpact, cmeReopenLabel, countdownLabel, nextAnnouncement, releaseExpired, splitFirstSentence, surprise } from '../../session-live.util';

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
 * Couleur : rouge si le créneau contient une annonce à impact fort, ambre sinon. Plusieurs annonces
 * à la même heure : une seule ligne, la plus importante en tête, « +N » déplie la liste des autres.
 *
 * Deux annonces fortes ou plus au même créneau : nommées ensemble avant la publication, puis un
 * onglet par annonce (la plus surprenante d'abord) avec son analyse — aucun appel IA de plus.
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
  /** Annonces publiées du même créneau (même heure) : une ligne, la plus importante en tête. */
  protected readonly releaseGroup = computed(() => {
    const list = this.releases();
    if (!list.length) return [];
    const time = list[0].event.time;
    const group = list.filter((r) => r.event.time === time);
    const order = byImpact(group.map((r) => r.event));
    return order.map((e) => group.find((r) => r.event === e)!);
  });
  /**
   * Au moins deux annonces FORTES publiées ensemble : un onglet chacune (la plus surprenante
   * ouverte d'abord), une seule analyse visible à la fois — la carte garde sa hauteur.
   */
  protected readonly strongReleases = computed(() =>
    [...this.releaseGroup().filter((r) => r.event.impact === 'high')]
      .sort((a, b) => (surprise(b.event) ?? -1) - (surprise(a.event) ?? -1)),
  );
  protected readonly useTabs = computed(() => this.strongReleases().length >= 2);
  protected readonly selectedTab = signal<string | null>(null);
  /** Onglets déjà ouverts (le point « pas encore lu » disparaît). */
  private readonly readTabs = signal<ReadonlySet<string>>(new Set());
  protected readonly release = computed(() => {
    if (!this.useTabs()) return this.releaseGroup()[0] ?? null;
    const strong = this.strongReleases();
    return strong.find((r) => r.event.name === this.selectedTab()) ?? strong[0];
  });
  /** Autres annonces du créneau, en lignes compactes dans le dépliage (impact moyen avec onglets). */
  protected readonly otherReleases = computed(() => {
    const shown = this.release();
    return this.useTabs()
      ? this.releaseGroup().filter((r) => r.event.impact !== 'high')
      : this.releaseGroup().filter((r) => r !== shown);
  });
  protected readonly expanded = signal(false);
  /** Liste des autres annonces du créneau à venir dépliée. */
  protected readonly showAll = signal(false);
  /** Créneau à venir : annonces fortes nommées en clair, les moyennes derrière « +N ». */
  protected readonly nextStrong = computed(() => this.next()?.events.filter((e) => e.impact === 'high') ?? []);
  protected readonly nextRest = computed(() => {
    const n = this.next();
    if (!n) return [];
    return this.nextStrong().length >= 2 ? n.events.filter((e) => e.impact !== 'high') : n.events.slice(1);
  });
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
    this.selectedTab.set(null);
    this.readTabs.set(new Set());

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

  /** « J'ai lu » : les annonces publiées du créneau laissent la place aux suivantes. */
  protected dismiss(): void {
    const read = new Set(this.releaseGroup());
    this.releases.update((list) => list.filter((r) => !read.has(r)));
    this.expanded.set(false);
  }

  protected selectTab(name: string): void {
    const current = this.release()?.event.name;
    if (current) this.readTabs.update((s) => new Set(s).add(current));
    this.selectedTab.set(name);
    this.readTabs.update((s) => new Set(s).add(name));
    this.expanded.set(false);
  }

  /** Nom court d'onglet : « NFP · Emplois non-agricoles » → « NFP » (la ligne reste sur une ligne). */
  protected tabName(raw: string): string {
    return this.name(raw).split(' · ')[0];
  }

  /** Point sur un onglet pas encore ouvert. */
  protected unread(name: string): boolean {
    return name !== this.release()?.event.name && !this.readTabs().has(name);
  }

  protected impactLabel(impact: 'high' | 'medium'): string {
    return impact === 'high' ? 'impact fort' : 'impact moyen';
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
