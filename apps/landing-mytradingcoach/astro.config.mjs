// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.mytradingcoach.app',
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      filter: (page) => !page.includes('/404'),
      serialize: (item) => {
        // Homepage — priorité maximale
        if (item.url === 'https://www.mytradingcoach.app/') {
          return { ...item, priority: 1.0, changefreq: 'daily' };
        }
        // Page blog index
        if (item.url === 'https://www.mytradingcoach.app/blog/') {
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