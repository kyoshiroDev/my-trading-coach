import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Mêmes flags que src/config.ts, lus au build (process.env.PUBLIC_*). Une page
// gatée ne doit JAMAIS être listée dans le sitemap tant que sa feature est OFF
// (sinon Google crawle une URL qui redirige → « Page avec redirection »).
const flag = (v) => v === 'true' || v === '1';
const MULTI_ACCOUNTS = flag(process.env.PUBLIC_FEATURE_MULTI_ACCOUNTS);
const REFERRAL = flag(process.env.PUBLIC_FEATURE_REFERRAL);

export default defineConfig({
  site: 'https://www.mytradingcoach.app',
  // Forme d'URL canonique unique : jamais de slash final (sauf la racine `/`).
  // Évite que `/page` et `/page/` coexistent → « Pages avec redirection » côté GSC.
  trailingSlash: 'never',
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      filter: (page) => {
        if (page.includes('/404') || page.includes('/confidentialite')) return false;
        if (!MULTI_ACCOUNTS && page.includes('/journal-trading-prop-firm')) return false;
        if (!REFERRAL && page.includes('/ambassadeur')) return false;
        return true;
      },
      serialize: (item) => {
        // URLs sans slash final (trailingSlash: 'never') : la home est `.../app`, l'index `.../blog`.
        // Homepage — priorité maximale.
        // NB : inutile de forcer le slash final ici pour coller au canonical
        // `https://www.mytradingcoach.app/` — @astrojs/sitemap renormalise les
        // URL après `serialize` selon `trailingSlash: 'never'`. Sans effet côté
        // SEO de toute façon : la racine nue et `/` sont la même URL pour Google.
        if (item.url === 'https://www.mytradingcoach.app' || item.url === 'https://www.mytradingcoach.app/') {
          return { ...item, priority: 1.0, changefreq: 'daily' };
        }
        // Page blog index
        if (item.url === 'https://www.mytradingcoach.app/blog') {
          return { ...item, priority: 0.8, changefreq: 'weekly' };
        }
        // Articles de blog
        if (item.url.includes('/blog/')) {
          return { ...item, priority: 0.8, changefreq: 'monthly' };
        }
        // Pages légales — basse priorité
        if (
          item.url.includes('/mentions-legales') ||
          item.url.includes('/confidentialite') ||
          item.url.includes('/politique-confidentialite') ||
          item.url.includes('/cgu')
        ) {
          return { ...item, priority: 0.3, changefreq: 'yearly' };
        }
        return { ...item, priority: 0.7, changefreq: 'weekly' };
      },
    }),
  ],
  output: 'static',
  build: {
    assets: '_assets',
  },
});