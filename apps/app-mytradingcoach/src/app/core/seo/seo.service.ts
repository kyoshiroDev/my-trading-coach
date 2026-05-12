import { Injectable, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

export interface SeoConfig {
  title?: string;
  description?: string;
  noindex?: boolean;
}

const BASE_TITLE = 'MyTradingCoach';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);

  apply(config: SeoConfig): void {
    if (config.title) {
      this.title.setTitle(`${config.title} — ${BASE_TITLE}`);
    }

    if (config.description) {
      this.meta.updateTag({ name: 'description', content: config.description });
    }

    if (config.noindex) {
      this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    } else {
      this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    }
  }
}
