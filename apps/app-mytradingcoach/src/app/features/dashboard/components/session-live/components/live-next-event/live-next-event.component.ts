import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import type { EcoEvent } from '@mtc/shared';
import { translateEcoEvent } from '@app/core/data/eco-event-translations';
import { countdownLabel, nextAnnouncement } from '../../session-live.util';

/**
 * « Prochaine annonce » de la session live v3 : une ligne, compte à rebours recalculé chaque
 * minute. Plus d'annonce aujourd'hui → rien (pas d'état vide). Le calendrier complet reste dans
 * la Pré-session.
 */
@Component({
  selector: 'mtc-live-next-event',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './live-next-event.component.css',
  template: `
    @if (next(); as n) {
      <section class="ne-line" data-testid="live-next-event" aria-label="Prochaine annonce">
        <div class="ne-body">
          <div class="ne-lbl">PROCHAINE ANNONCE</div>
          <div class="ne-name">
            {{ name(n.event.name) }} · {{ time(n.event.time) }}
            <span class="ne-impact">{{ n.event.impact === 'high' ? 'impact fort' : 'impact moyen' }}</span>
          </div>
        </div>
        <span class="ne-count" data-testid="live-next-event-countdown">{{ countdown(n.minutes) }}</span>
      </section>
    }
  `,
})
export class LiveNextEventComponent {
  readonly events = input<EcoEvent[]>([]);

  private readonly now = signal(new Date());
  protected readonly next = computed(() => nextAnnouncement(this.events(), this.now()));
  protected readonly countdown = countdownLabel;
  protected readonly name = translateEcoEvent;

  constructor() {
    interval(60_000)
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe(() => this.now.set(new Date()));
  }

  protected time(t: string): string {
    if (!t) return '';
    return t.includes('T')
      ? new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : t.slice(0, 5);
  }
}
