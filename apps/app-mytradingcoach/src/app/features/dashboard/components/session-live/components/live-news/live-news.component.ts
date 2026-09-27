import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideDynamicIcon, LucideNewspaper as Newspaper } from '@lucide/angular';
import { NewsItem, TradesApi } from '@app/core/api/trades.api';
import { UserStore } from '@app/core/stores/user.store';
import { DialogDirective } from '@mtc/front-ui';

/**
 * News live de la session : ticker horizontal (défilement continu) dans la carte marché,
 * et modale de lecture. Le corps d'une news n'est traduit qu'à sa première ouverture.
 */
@Component({
  selector: 'mtc-live-news',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, DialogDirective],
  styleUrl: './live-news.component.css',
  template: `
    <div class="news-ticker">
      <span class="news-ticker-lbl"><svg [lucideIcon]="NewsIcon" [size]="13" class="news-live-ic"></svg> News live</span>
      <div class="news-ticker-viewport">
        <div class="news-ticker-track">
          @for (item of items(); track item.publishedDate) {
            <button type="button" class="news-tick" (click)="openNews(item)">
              <span class="news-tick-tag">{{ item.symbol }}</span>
              <span class="news-tick-title">{{ item.title }}</span>
              <span class="news-tick-time">{{ formatNewsTime(item.publishedDate) }}</span>
            </button>
            <span class="news-tick-sep">·</span>
          }
          <!-- Copie pour un défilement continu (marquee) -->
          @for (item of items(); track 'dup-' + item.publishedDate) {
            <button type="button" class="news-tick" tabindex="-1" aria-hidden="true" (click)="openNews(item)">
              <span class="news-tick-tag">{{ item.symbol }}</span>
              <span class="news-tick-title">{{ item.title }}</span>
              <span class="news-tick-time">{{ formatNewsTime(item.publishedDate) }}</span>
            </button>
            <span class="news-tick-sep" aria-hidden="true">·</span>
          }
        </div>
      </div>
    </div>

    <!-- Modale news -->
    @if (selectedNews(); as news) {
      <div class="news-modal-overlay"
           role="button"
           tabindex="0"
           (click)="closeNews()"
           (keyup.escape)="closeNews()">
        <div class="news-modal"
             role="dialog" aria-modal="true" mtcDialog
             (mtcDialogClose)="closeNews()"
             aria-labelledby="news-modal-title"
             (click)="$event.stopPropagation()"
             (keydown)="$event.stopPropagation()">
          <!-- Header -->
          <div class="nm-header">
            <div class="nm-meta">
              <span class="news-asset-tag">{{ news.symbol }}</span>
              @if (news.site) {
                <span class="nm-source">{{ news.site }}</span>
              }
              <span class="news-sentiment" [class]="news.sentiment ?? 'neutral'">
                {{ news.sentiment === 'bull' ? '▲ Bull' : news.sentiment === 'bear' ? '▼ Bear' : '- Neutre' }}
              </span>
              <span class="nm-date">{{ formatNewsTime(news.publishedDate) }}</span>
            </div>
            <button class="nm-close" (click)="closeNews()" aria-label="Fermer">✕</button>
          </div>

          <!-- Zone scrollable : image + titre + corps + lien -->
          <div class="nm-body-wrap">
            @if (news.image) {
              <img class="nm-image" [src]="news.image" [alt]="news.title" loading="lazy" />
            }
            <h2 id="news-modal-title" class="nm-title">{{ news.title }}</h2>
            @if (translatingNewsText()) {
              <p class="nm-translating" aria-live="polite">Traduction…</p>
            }
            @if (news.text) {
              <p class="nm-body">{{ news.text }}</p>
            }
            @if (news.url) {
              <a class="nm-cta" [href]="news.url" target="_blank" rel="noopener noreferrer">
                Lire l'article complet ↗
              </a>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class LiveNewsComponent {
  readonly items = input<NewsItem[]>([]);

  private readonly destroyRef = inject(DestroyRef);
  private readonly tradesApi = inject(TradesApi);
  private readonly userStore = inject(UserStore);

  protected readonly NewsIcon = Newspaper;

  // Modal news
  protected readonly selectedNews = signal<NewsItem | null>(null);
  // Traduction paresseuse du corps : true pendant l'appel à /news/:id/text.
  protected readonly translatingNewsText = signal(false);

  protected openNews(item: NewsItem): void {
    this.selectedNews.set(item);
    this.translatingNewsText.set(false);

    // Traduction du texte à la demande (1re ouverture) : le corps n'est traduit
    // que pour les news réellement consultées. Hors démo, et seulement s'il y a du texte.
    if (item.textTranslated === false && !!item.text && !this.userStore.isDemo()) {
      this.translatingNewsText.set(true);
      this.tradesApi.newsText(item.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (res) => {
            this.translatingNewsText.set(false);
            const fr = res.data?.text ?? null;
            if (fr) {
              this.selectedNews.update((n) =>
                n && n.id === item.id ? { ...n, text: fr, textTranslated: true } : n,
              );
            }
          },
          error: () => this.translatingNewsText.set(false),
        });
    }
  }

  protected closeNews(): void {
    this.selectedNews.set(null);
    this.translatingNewsText.set(false);
  }

  protected formatNewsTime(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
}
