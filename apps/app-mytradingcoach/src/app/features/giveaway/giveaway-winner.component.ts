import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideDynamicIcon, LucideTrophy as Trophy } from '@lucide/angular';
import { ErrorStateComponent } from '@mtc/front-ui';
import {
  GIVEAWAY_MESSAGE_MAX,
  GIVEAWAY_PSEUDO_MAX,
  apiErrorMessage,
  type GiveawayDisplayConsent,
  type GiveawayMyWin,
} from '@mtc/shared';
import { GiveawayApi } from '../../core/api/giveaway.api';
import { GiveawayStateService } from '../../core/services/giveaway-state.service';
import { UserStore } from '../../core/stores/user.store';
import { longDateLabel } from './giveaway.component';

/**
 * Page gagnant (lien de l'e-mail, PROMPT-tirage-mensuel lot B) : lot activé et date de fin, choix de
 * l'affichage (aucun, pseudo, prénom + initiale), message facultatif (≤ 140), accord Instagram
 * séparé et décoché par défaut. Tout reste modifiable ; un message modifié repasse en modération.
 */
@Component({
  selector: 'mtc-giveaway-winner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ErrorStateComponent, FormsModule, RouterLink, LucideDynamicIcon],
  styleUrl: './giveaway.component.css',
  templateUrl: './giveaway-winner.component.html',
})
export class GiveawayWinnerComponent {
  private readonly api = inject(GiveawayApi);
  private readonly store = inject(GiveawayStateService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly userStore = inject(UserStore);
  protected readonly TrophyIcon = Trophy;
  protected readonly MESSAGE_MAX = GIVEAWAY_MESSAGE_MAX;
  protected readonly PSEUDO_MAX = GIVEAWAY_PSEUDO_MAX;
  /** Pseudo Instagram : la longueur maximale, plus un « @ » éventuel retiré par l'API. */
  protected readonly INSTAGRAM_INPUT_MAX = GIVEAWAY_PSEUDO_MAX + 1;
  protected readonly longDate = longDateLabel;

  protected readonly state = this.store.state;
  protected readonly loadError = this.store.loadError;
  protected readonly win = computed(() => this.state()?.myWin ?? null);

  protected readonly consent = signal<GiveawayDisplayConsent>('NONE');
  protected readonly pseudo = signal('');
  protected readonly message = signal('');
  protected readonly instagramConsent = signal(false);
  protected readonly instagramHandle = signal('');
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    if (!this.state()) this.store.load();
    // Formulaire rempli une fois avec les réglages enregistrés.
    let filled = false;
    effect(() => {
      const w = this.win();
      if (w && !filled) {
        filled = true;
        untracked(() => this.fill(w));
      }
    });
  }

  private fill(w: GiveawayMyWin): void {
    this.consent.set(w.displayConsent);
    this.pseudo.set(w.displayPseudo ?? '');
    this.message.set(w.message ?? '');
    this.instagramConsent.set(w.instagramConsent);
    this.instagramHandle.set(w.instagramHandle ?? '');
  }

  protected reload(): void {
    this.store.load();
  }

  protected save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    this.api
      .updateMyWin({
        displayConsent: this.consent(),
        displayPseudo: this.pseudo().trim() || null,
        message: this.message().trim() || null,
        instagramConsent: this.instagramConsent(),
        instagramHandle: this.instagramConsent() ? this.instagramHandle().trim() || null : null,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.saving.set(false);
          this.saved.set(true);
          const s = this.state();
          if (s) this.state.set({ ...s, myWin: r.data });
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(apiErrorMessage(err, 'Tes choix n’ont pas été enregistrés. Réessaie.'));
        },
      });
  }
}
