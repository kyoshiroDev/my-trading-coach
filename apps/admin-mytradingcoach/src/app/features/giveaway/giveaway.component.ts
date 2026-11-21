import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { Observable } from 'rxjs';
import { GIVEAWAY_DRAW_HOUR, apiErrorMessage, giveawayDrawDayLabel, type AdminGiveawayInstagramPreview, type AdminGiveawayData, type AdminGiveawayPoolState, type AdminGiveawayWin, type GiveawayPool } from '@mtc/shared';
import { ErrorStateComponent } from '@mtc/front-ui';
import { AdminApi } from '../../core/api/admin.api';

const POOL_LABEL: Record<GiveawayPool, string> = { FREE: 'Tirage gratuits', PREMIUM: 'Tirage Premium' };
const ACTIVATION_LABEL: Record<AdminGiveawayWin['activationStatus'], string> = {
  PENDING: 'En cours', APPLIED: 'Attribué', FAILED: 'Échec',
};
const MODERATION_LABEL: Record<AdminGiveawayWin['moderation'], string> = {
  EN_ATTENTE: 'À modérer', VALIDE: 'Validé', REFUSE: 'Refusé',
};
const CONSENT_LABEL: Record<AdminGiveawayWin['displayConsent'], string> = {
  NONE: 'Aucun', PSEUDO: 'Pseudo', PRENOM_INITIALE: 'Prénom + initiale',
};
const PUBLICATION_LABEL: Record<AdminGiveawayWin['publicationStatus'], string> = {
  NONE: 'Non publié', PUBLISHED: 'Publié', FAILED: 'Échec',
};

/**
 * Onglet « Tirages » (PROMPT-tirage-mensuel) : deux interrupteurs indépendants (confirmation dans la
 * page avec le nombre d'e-mails d'annonce), historique, modération des messages des gagnants et
 * relance d'une attribution en échec. « Tirer maintenant » seulement si l'API le permet (hors prod).
 */
@Component({
  selector: 'mtc-admin-giveaway',
  imports: [DatePipe, RouterLink, ErrorStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './giveaway.component.css',
  templateUrl: './giveaway.component.html',
})
export class GiveawayComponent {
  private readonly api = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly POOL_LABEL = POOL_LABEL;
  protected readonly DRAW_DAY = giveawayDrawDayLabel();
  protected readonly DRAW_HOUR = GIVEAWAY_DRAW_HOUR;
  protected readonly ACTIVATION_LABEL = ACTIVATION_LABEL;
  protected readonly MODERATION_LABEL = MODERATION_LABEL;
  protected readonly CONSENT_LABEL = CONSENT_LABEL;
  protected readonly PUBLICATION_LABEL = PUBLICATION_LABEL;

  protected readonly data = signal<AdminGiveawayData | null>(null);
  protected readonly isLoading = signal(true);
  protected readonly loadError = signal(false);
  /** Tirage dont la confirmation est ouverte. */
  protected readonly confirming = signal<GiveawayPool | null>(null);
  protected readonly busy = signal<string | null>(null);
  protected readonly actionError = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  constructor() {
    this.load();
  }

  protected load(): void {
    this.api
      .giveaway()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.data.set(r.data);
          this.loadError.set(false);
          this.isLoading.set(false);
        },
        error: () => {
          this.loadError.set(true);
          this.isLoading.set(false);
        },
      });
  }

  protected pools(d: AdminGiveawayData): AdminGiveawayPoolState[] {
    return [d.free, d.premium];
  }

  /** Allumer : confirmation dans la page. Éteindre : direct (rien n'est envoyé). */
  protected toggle(state: AdminGiveawayPoolState): void {
    this.actionError.set(null);
    this.notice.set(null);
    if (state.enabled) this.apply(state.pool, false);
    else this.confirming.set(state.pool);
  }

  protected apply(pool: GiveawayPool, enabled: boolean): void {
    this.busy.set(`pool-${pool}`);
    this.api
      .setGiveaway(pool, enabled)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.busy.set(null);
          this.confirming.set(null);
          const n = r.data.announcementsQueued;
          this.notice.set(
            enabled
              ? `${POOL_LABEL[pool]} allumé. ${n} e-mail${n > 1 ? 's' : ''} d'annonce en cours d'envoi.`
              : `${POOL_LABEL[pool]} éteint. Aucun e-mail envoyé, les lots déjà gagnés restent acquis.`,
          );
          this.load();
        },
        error: (err: unknown) => {
          this.busy.set(null);
          this.actionError.set(apiErrorMessage(err, "La modification n'a pas été enregistrée. Réessaie."));
        },
      });
  }

  protected moderate(win: AdminGiveawayWin, moderation: 'VALIDE' | 'REFUSE'): void {
    this.run(`mod-${win.id}`, this.api.moderateGiveawayWin(win.id, moderation), "La modération n'a pas été enregistrée. Réessaie.");
  }

  protected retry(win: AdminGiveawayWin): void {
    this.run(`retry-${win.id}`, this.api.retryGiveawayWin(win.id), "La relance a échoué. Réessaie.");
  }

  protected drawNow(pool: GiveawayPool): void {
    this.run(`draw-${pool}`, this.api.drawGiveawayNow(pool), 'Le tirage manuel a échoué.');
  }

  private run(key: string, call: Observable<unknown>, error: string): void {
    this.busy.set(key);
    this.actionError.set(null);
    this.notice.set(null);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.actionError.set(apiErrorMessage(err, error));
      },
    });
  }

  // ── Publication Instagram (lot C) ──
  protected readonly igWin = signal<AdminGiveawayWin | null>(null);
  protected readonly igPreview = signal<AdminGiveawayInstagramPreview | null>(null);
  protected readonly igCaption = signal('');
  protected readonly igPublishAt = signal('');
  protected readonly igCopied = signal(false);
  /** Metricool absent ou refus à la publication : « Ouvrir l'image » et « Copier la légende ». */
  protected readonly igFallback = signal(false);
  protected readonly igError = signal<string | null>(null);

  /** « Publier » seulement avec l'accord Instagram du gagnant et un message validé (ou aucun). */
  protected canPublish(w: AdminGiveawayWin): boolean {
    return w.instagramConsent && w.activationStatus === 'APPLIED' && (!w.message || w.moderation === 'VALIDE') && w.publicationStatus !== 'PUBLISHED';
  }

  protected openInstagram(w: AdminGiveawayWin): void {
    this.igWin.set(w);
    this.igPreview.set(null);
    this.igCopied.set(false);
    this.igFallback.set(false);
    this.igError.set(null);
    this.igPublishAt.set('');
    this.busy.set(`ig-${w.id}`);
    this.actionError.set(null);
    this.api
      .instagramPreview(w.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.busy.set(null);
          this.igPreview.set(r.data);
          this.igCaption.set(r.data.caption);
        },
        error: (err: unknown) => {
          this.busy.set(null);
          this.igWin.set(null);
          this.actionError.set(apiErrorMessage(err, 'L’aperçu Instagram n’a pas pu être préparé.'));
        },
      });
  }

  protected closeInstagram(): void {
    this.igWin.set(null);
    this.igPreview.set(null);
  }

  protected confirmInstagram(): void {
    const w = this.igWin();
    const p = this.igPreview();
    if (!w || !p) return;
    const at = this.igPublishAt();
    this.busy.set(`ig-pub-${w.id}`);
    this.igError.set(null);
    this.api
      .instagramPublish(w.id, { caption: this.igCaption(), imageUrl: p.imageUrl, publishAt: at ? new Date(at).toISOString() : null })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(null);
          this.closeInstagram();
          this.notice.set('Publication envoyée à Metricool.');
          this.load();
        },
        error: (err: unknown) => {
          this.busy.set(null);
          const status = err instanceof HttpErrorResponse ? err.status : 0;
          if (status === 502) {
            // Refus ou panne de Metricool : publication manuelle.
            this.igFallback.set(true);
            this.igError.set(apiErrorMessage(err, 'Metricool a refusé la publication. Ouvre l’image et copie la légende.'));
          } else if (status === 409) {
            // Déjà publié ou en cours (autre onglet) : jamais de publication manuelle en double.
            this.igError.set(apiErrorMessage(err, 'Ce gagnant a déjà été publié sur Instagram.'));
            this.load();
          } else {
            // Heure invalide, légende refusée, réseau : l'admin corrige et réessaie.
            this.igError.set(apiErrorMessage(err, 'La publication a échoué. Réessaie.'));
          }
        },
      });
  }

  protected async copyCaption(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.igCaption());
      this.igCopied.set(true);
    } catch {
      this.igError.set('Copie impossible\u00a0: sélectionne la légende à la main.');
    }
  }

  protected euros(cents: number): string {
    return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
  }
}
