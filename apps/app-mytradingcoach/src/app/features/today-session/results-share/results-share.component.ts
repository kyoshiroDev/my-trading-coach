import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  LucideDynamicIcon,
  LucideShare2 as Share2,
  LucideDownload as Download,
  LucideExternalLink as ExternalLink,
  LucideX as X,
  LucideImagePlus as ImagePlus,
} from '@lucide/angular';
import { DialogDirective } from '@mtc/front-ui';
import { ReferralApi } from '../../../core/api/referral.api';
import { ToastService } from '../../../core/services/toast.service';
import { ResultsCardComponent } from '../../../shared/components/results-card/results-card.component';
import {
  RESULTS_CARD_SIZE,
  ResultsCardData,
  ResultsCardFormat,
  resultsFileName,
  shareText,
} from '../../../shared/components/results-card/results-card.util';

type Rendered = { file: File; url: string };

const HINT_MS = 8000;
/** Garde-fou de l'upload de graphique (le fichier ne quitte jamais le navigateur). */
export const CHART_MAX_BYTES = 10 * 1024 * 1024;
/** Côté le plus long après réduction : assez pour un panneau de 1080 px, léger pour iOS. */
const CHART_MAX_SIDE = 1600;

/**
 * « Publier mes résultats » (onglet Débrief, session clôturée, bêta) : la carte est rendue
 * hors écran puis convertie en PNG dans le navigateur — aucun appel réseau, rien sur le serveur.
 * Mobile : partage natif (Instagram apparaît dans le sélecteur comme pour une photo).
 * Desktop : télécharger l'image puis l'envoyer depuis instagram.com.
 * Instagram ne rend jamais le lien cliquable sur une image : l'UI ne le promet pas.
 */
@Component({
  selector: 'mtc-results-share',
  imports: [DialogDirective, LucideDynamicIcon, ResultsCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './results-share.component.css',
  templateUrl: './results-share.component.html',
  host: { '(document:click)': 'hideHint()' },
})
export class ResultsShareComponent {
  /** Carte sans code de parrainage : complétée ici une fois `/referral/me` répondu. */
  readonly data = input.required<Omit<ResultsCardData, 'referralCode'>>();
  readonly disabled = input(false);
  readonly date = input.required<Date>();

  private readonly referralApi = inject(ReferralApi);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly open = signal(false);
  protected readonly format = signal<ResultsCardFormat>('square');
  protected readonly generating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hint = signal(false);
  private readonly referralCode = signal<string | null>(null);
  private referralLoaded = false;
  private readonly rendered = signal<Partial<Record<ResultsCardFormat, Rendered>>>({});
  private fontCss: string | null = null;
  /** Screenshot de graphique optionnel (Tradovate, TradingView…), réduit et gardé en local. */
  protected readonly chartUrl = signal<string | null>(null);
  protected readonly chartError = signal<string | null>(null);
  private hintTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly cardData = computed<ResultsCardData>(() => ({ ...this.data(), referralCode: this.referralCode() }));
  protected readonly current = computed(() => this.rendered()[this.format()] ?? null);
  protected readonly size = computed(() => RESULTS_CARD_SIZE[this.format()]);
  /** Partage de fichiers natif dispo (mobile) ; sinon chemin desktop Télécharger + Instagram. */
  protected readonly nativeShare = computed(() => {
    const r = this.current();
    return !!r && typeof navigator.canShare === 'function' && navigator.canShare({ files: [r.file] });
  });

  protected readonly ShareIcon = Share2;
  protected readonly DownloadIcon = Download;
  protected readonly ExternalIcon = ExternalLink;
  protected readonly CloseIcon = X;
  protected readonly ChartIcon = ImagePlus;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.revokeAll();
      this.setChart(null);
      if (this.hintTimer) clearTimeout(this.hintTimer);
    });
  }

  protected async openModal(): Promise<void> {
    if (this.disabled()) return;
    // Les stats ont pu bouger depuis la dernière ouverture (humeur changée, trade synchronisé).
    this.revokeAll();
    this.error.set(null);
    this.open.set(true);
    await this.loadReferral();
    await this.render();
  }

  protected close(): void {
    this.open.set(false);
    this.hint.set(false);
  }

  protected async selectFormat(format: ResultsCardFormat): Promise<void> {
    if (format === this.format()) return;
    this.format.set(format);
    if (!this.current()) await this.render();
  }

  /** Choix d'un screenshot : image/* et 10 Mo max, sinon message clair (jamais d'échec muet). */
  protected async onChartSelected(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = ''; // re-choisir le même fichier redéclenche `change`
    if (!file) return;
    this.chartError.set(null);
    if (!file.type.startsWith('image/')) {
      this.chartError.set('Ce fichier n’est pas une image. Choisis une capture de ton graphique.');
      return;
    }
    if (file.size > CHART_MAX_BYTES) {
      this.chartError.set('Image trop lourde (10 Mo max). Fais une capture plus légère.');
      return;
    }
    try {
      this.setChart(await shrinkImage(file, CHART_MAX_SIDE));
    } catch {
      this.chartError.set('Cette image n’a pas pu être lue. Essaie une capture en PNG ou JPEG.');
      return;
    }
    await this.rerender();
  }

  protected async removeChart(): Promise<void> {
    this.setChart(null);
    this.chartError.set(null);
    await this.rerender();
  }

  private setChart(url: string | null): void {
    const previous = this.chartUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.chartUrl.set(url);
  }

  /** La composition a changé : les PNG des deux formats sont périmés. */
  private async rerender(): Promise<void> {
    this.revokeAll();
    if (this.open()) await this.render();
  }

  protected async share(): Promise<void> {
    const r = this.current();
    if (!r) return;
    try {
      // Fichier déjà généré : l'appel part dans le geste utilisateur (exigence de Safari iOS).
      await navigator.share({ files: [r.file], title: 'Mes résultats MyTradingCoach', text: shareText(this.referralCode()) });
      this.showHint();
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return; // l'utilisateur a fermé le sélecteur
      this.toast.error('Le partage n’a pas abouti. Télécharge l’image à la place.');
      this.download();
    }
  }

  /** Déclenché par le clic sur le lien `download` : la navigation fait le téléchargement. */
  protected onDownloaded(event: Event): void {
    event.stopPropagation(); // sinon le clic document masque aussitôt le rappel
    this.showHint();
  }

  protected hideHint(): void {
    this.hint.set(false);
  }

  private download(): void {
    const r = this.current();
    if (!r) return;
    const a = document.createElement('a');
    a.href = r.url;
    a.download = r.file.name;
    a.click();
    this.showHint();
  }

  private showHint(): void {
    this.hint.set(true);
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.hint.set(false), HINT_MS);
  }

  private async loadReferral(): Promise<void> {
    if (this.referralLoaded) return;
    try {
      const res = await firstValueFrom(this.referralApi.getMyReferral());
      this.referralCode.set(res.data.referralCode || null);
      this.referralLoaded = true;
    } catch {
      // Carte avec le domaine seul plutôt qu'aucune carte ; on retentera à la prochaine ouverture.
      this.referralCode.set(null);
    }
  }

  private async render(): Promise<void> {
    const format = this.format();
    this.generating.set(true);
    this.error.set(null);
    try {
      await this.nextRender();
      const node = this.host.nativeElement.querySelector<HTMLElement>('.rs-offscreen mtc-results-card');
      if (!node) throw new Error('card not rendered');
      await document.fonts?.ready;

      const { toBlob, getFontEmbedCSS } = await import('html-to-image');
      const { width, height } = RESULTS_CARD_SIZE[format];
      this.fontCss ??= await getFontEmbedCSS(node, { preferredFontFormat: 'woff2' });
      const options = { width, height, pixelRatio: 1, fontEmbedCSS: this.fontCss, backgroundColor: '#06090f' };
      // WebKit peint parfois l'image SVG avant d'avoir décodé polices et logo : 1er rendu à blanc.
      if (isWebKit()) await toBlob(node, options);
      const blob = await toBlob(node, options);
      if (!blob) throw new Error('empty blob');

      const file = new File([blob], resultsFileName(this.date(), format), { type: 'image/png' });
      this.rendered.update((r) => ({ ...r, [format]: { file, url: URL.createObjectURL(blob) } }));
    } catch {
      this.error.set('L’image n’a pas pu être générée. Réessaie.');
    } finally {
      this.generating.set(false);
    }
  }

  protected retry(): void {
    void this.render();
  }

  /** Attend que la carte hors écran reflète le format et les données courants. */
  private nextRender(): Promise<void> {
    return new Promise((resolve) => afterNextRender(() => resolve(), { injector: this.injector }));
  }

  private revokeAll(): void {
    for (const r of Object.values(this.rendered())) if (r) URL.revokeObjectURL(r.url);
    this.rendered.set({});
  }
}

/**
 * Décode l'image (rejette ce que le navigateur ne sait pas lire, ex. HEIC sur Chrome) et la
 * réduit : une photo de 12 Mpx embarquée telle quelle dans le SVG de html-to-image fait
 * échouer le rendu sur iPhone. Retourne une URL `blob:` locale.
 */
async function shrinkImage(file: File, maxSide: number): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('encode failed');
    return URL.createObjectURL(blob);
  } finally {
    URL.revokeObjectURL(src);
  }
}

function isWebKit(): boolean {
  const ua = navigator.userAgent;
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Android/.test(ua);
}
