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
      customPages: [
        'https://www.mytradingcoach.app/',
        'https://www.mytradingcoach.app/blog/',
        'https://www.mytradingcoach.app/mentions-legales',
        'https://www.mytradingcoach.app/confidentialite',
        'https://www.mytradingcoach.app/cgu',
      ],
    }),
  ],
  output: 'static',
  build: {
    assets: '_assets',
  },
});