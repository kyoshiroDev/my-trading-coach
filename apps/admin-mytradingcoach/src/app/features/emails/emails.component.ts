import {
  ChangeDetectionStrategy, Component, DestroyRef,
  computed, inject, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, catchError, debounce, of, switchMap, timer } from 'rxjs';
import {
  LucideDynamicIcon,
  LucideSend as Send,
  LucideEye as Eye,
  LucideX as X,
  LucideRefreshCw as RefreshCw,
} from '@lucide/angular';
import { AdminApi, CampaignMeta } from '../../core/api/admin.api';
import { DialogDirective } from '@mtc/front-ui';

const PREVIEW_DEBOUNCE_MS = 400;

@Component({
  selector: 'mtc-admin-emails',
  imports: [DialogDirective, FormsModule, DatePipe, LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './emails.component.css',
  templateUrl: './emails.component.html',
})
export class EmailsComponent {
  private readonly adminApi   = inject(AdminApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer  = inject(DomSanitizer);

  protected readonly SendIcon    = Send;
  protected readonly EyeIcon     = Eye;
  protected readonly XIcon       = X;
  protected readonly RefreshIcon = RefreshCw;

  protected readonly loading            = signal(true);
  protected readonly campaigns          = signal<CampaignMeta[]>([]);
  protected readonly previewCampaign    = signal<CampaignMeta | null>(null);
  protected readonly previewLoading     = signal(false);
  protected readonly previewHtml        = signal('');
  protected readonly previewRecipients  = signal<{ email: string; name: string | null }[]>([]);
  protected readonly sendCampaignModal  = signal<CampaignMeta | null>(null);
  protected readonly sending            = signal(false);
  protected readonly testing            = signal(false);
  /** Le test a été fait sur le contenu actuel (au chargement, ou dans cette modale). */
  protected readonly tested             = signal(false);
  /** 2e étape : « Envoyer à N inscrits ? » avant l'envoi réel. */
  protected readonly confirming         = signal(false);
  protected readonly toast              = signal<{ message: string; error?: boolean } | null>(null);

  protected readonly announcementSubject = signal('');
  protected readonly announcementBody    = signal('');
  protected readonly force               = signal(false);

  // Nombre d'envois visé : nouveaux par défaut, tout le segment si "force".
  protected readonly sendCount = computed(() => {
    const c = this.sendCampaignModal();
    if (!c) return 0;
    if (c.requiresTest) return c.withConsent; // oneShot marketing, sans « force »
    return this.force() ? c.targetCount : c.newCount;
  });

  // HTML renvoyé par l'API = celui réellement envoyé (même template backend), pour tous les types.
  protected readonly safePreviewHtml = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.previewHtml()),
  );

  protected readonly canSend = computed(() => {
    const c = this.sendCampaignModal();
    if (!c) return false;
    if (c.type === 'announcement' && !this.announcementSubject().trim()) return false;
    if (c.requiresTest && !this.tested()) return false;
    return true;
  });

  // Ouverture : rendu immédiat ; frappe : 400 ms de pause. switchMap annule la requête périmée.
  private readonly previewRequests = new Subject<{ campaign: CampaignMeta; debounced: boolean }>();

  constructor() {
    this.load();
    this.previewRequests
      .pipe(
        debounce(r => timer(r.debounced ? PREVIEW_DEBOUNCE_MS : 0)),
        switchMap(({ campaign }) =>
          this.adminApi
            .previewCampaign(campaign.type, this.announcementSubject(), this.announcementBody())
            .pipe(catchError(() => of(null))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(r => {
        if (r) {
          this.previewHtml.set(r.data.html);
          this.previewRecipients.set(r.data.recipients ?? []);
        }
        this.previewLoading.set(false);
      });
  }

  load(): void {
    this.loading.set(true);
    this.adminApi.listCampaigns()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: r => { this.campaigns.set(r.data ?? []); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  openPreview(c: CampaignMeta): void {
    this.previewCampaign.set(c);
    this.previewHtml.set('');
    this.previewRecipients.set([]);
    this.previewLoading.set(true);
    this.previewRequests.next({ campaign: c, debounced: false });
  }

  /** Objet / contenu modifiés dans l'aperçu : nouveau rendu serveur après une pause de frappe. */
  refreshPreview(): void {
    const c = this.previewCampaign();
    if (c) this.previewRequests.next({ campaign: c, debounced: true });
  }

  openSend(c: CampaignMeta): void {
    if (c.type !== 'announcement') {
      this.announcementSubject.set('');
      this.announcementBody.set('');
    }
    this.force.set(false);
    this.tested.set(c.testedCurrent);
    this.confirming.set(false);
    this.sendCampaignModal.set(c);
  }

  /** Contenu d'annonce modifié : le test précédent ne vaut plus (le serveur le vérifie aussi). */
  contentChanged(): void {
    this.tested.set(false);
    this.confirming.set(false);
  }

  doTest(): void {
    const c = this.sendCampaignModal();
    if (!c) return;
    this.testing.set(true);
    this.adminApi.testCampaign(c.type, this.announcementSubject(), this.announcementBody())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.testing.set(false);
          this.tested.set(true);
          this.showToast(`✅ Test envoyé à ${r.data.to}`);
        },
        error: (e: HttpErrorResponse) => {
          this.testing.set(false);
          this.showToast(`❌ ${e.error?.message ?? 'Erreur lors de l\'envoi test'}`, true);
        },
      });
  }

  doSend(): void {
    const c = this.sendCampaignModal();
    if (!c || !this.canSend()) return;
    this.sending.set(true);
    this.adminApi.sendCampaign(c.type, this.announcementSubject(), this.announcementBody(), this.force())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.sending.set(false);
          this.sendCampaignModal.set(null);
          const skipped = r.data.skipped ? ` · ${r.data.skipped} ignorés` : '';
          this.showToast(`✅ ${r.data.success} emails envoyés · ${r.data.errors} erreurs${skipped}`);
          this.load();
        },
        error: (e: HttpErrorResponse) => {
          this.sending.set(false);
          this.confirming.set(false);
          this.showToast(`❌ ${e.error?.message ?? 'Erreur lors de l\'envoi'}`, true);
        },
      });
  }

  private showToast(message: string, error = false): void {
    this.toast.set({ message, error });
    setTimeout(() => this.toast.set(null), 4000);
  }
}
