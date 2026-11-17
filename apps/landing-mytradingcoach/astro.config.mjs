import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readdirSync, readFileSync } from 'node:fs';

// lastmod du sitemap : date réelle de l'article (updatedDate, sinon publishDate), lue dans le
// frontmatter de src/content/blog. Les autres pages n'en ont pas : une date de build changeant
// à chaque déploiement faisait croire à Google que tout le site était modifié.
const BLOG_DIR = new URL('./src/content/blog/', import.meta.url);
const ARTICLE_DATES = Object.fromEntries(
  readdirSync(BLOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const fm = readFileSync(new URL(f, BLOG_DIR), 'utf8').split('---')[1] ?? '';
      const date = (key) => fm.match(new RegExp(`^${key}:\\s*(\\S+)`, 'm'))?.[1];
      return [f.replace(/\.md$/, ''), date('updatedDate') ?? date('publishDate')];
    }),
);

// lastmod des pages « règles des prop firms » (SEO phase 3) : date du relevé de la firme
// (`verified_at` du catalogue), lue dans les fichiers JSON de libs/shared. La page index prend la
// plus récente. Seules les pages réellement générées (firmRulePages) arrivent au sitemap.
const CATALOG_DIR = new URL('../../libs/shared/src/prop-firm-rules/', import.meta.url);
const FIRM_VERIFIED = Object.fromEntries(
  readdirSync(CATALOG_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'schema.json')
    .map((f) => JSON.parse(readFileSync(new URL(f, CATALOG_DIR), 'utf8')))
    .filter((j) => j?.firm?.id && j.verified_at)
    .map((j) => [j.firm.id, j.verified_at]),
);
const LATEST_FIRM_CHECK = Object.values(FIRM_VERIFIED).sort().at(-1);

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
      filter: (page) => {
        if (page.includes('/404') || page.includes('/confidentialite')) return false;
        // /prop-firm, page d'entrée, y est depuis le 2026-11-16 (SEO phase 1, option a de Greg).
        // Redirection temporaire de l'accueil (2026-11-08) : `/` part en 302 vers /prop-firm et
        // l'ancienne accueil vit sur /accueil (noindex). Ni l'une ni l'autre dans le sitemap.
        // Retrait : supprimer ces deux lignes avec la redirection (astro.md, « Accueil → /prop-firm »).
        if (/^https:\/\/www\.mytradingcoach\.app\/?$/.test(page)) return false;
        if (/\/accueil\/?$/.test(page)) return false;
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
        // Page d'entrée tant que `/` redirige vers elle (2026-11-08).
        if (item.url === 'https://www.mytradingcoach.app/prop-firm') {
          return { ...item, priority: 1.0, changefreq: 'weekly' };
        }
        // Règles des prop firms : lastmod = date du relevé (firme), ou la plus récente pour l'index.
        if (item.url === 'https://www.mytradingcoach.app/regles-prop-firm') {
          return { ...item, priority: 0.8, changefreq: 'weekly', ...(LATEST_FIRM_CHECK && { lastmod: new Date(LATEST_FIRM_CHECK).toISOString() }) };
        }
        if (item.url.includes('/regles-prop-firm/')) {
          const firmId = item.url.split('/regles-prop-firm/')[1].replace(/-\d+k$/, '');
          const date = FIRM_VERIFIED[firmId];
          return { ...item, priority: 0.7, changefreq: 'weekly', ...(date && { lastmod: new Date(date).toISOString() }) };
        }
        // Page blog index
        if (item.url === 'https://www.mytradingcoach.app/blog') {
          return { ...item, priority: 0.8, changefreq: 'weekly' };
        }
        // Articles de blog
        if (item.url.includes('/blog/')) {
          const date = ARTICLE_DATES[item.url.split('/blog/')[1]];
          return { ...item, priority: 0.8, changefreq: 'monthly', ...(date && { lastmod: new Date(date).toISOString() }) };
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
  // Astro 7 passe la compression HTML par défaut à 'jsx' (supprime des espaces entre éléments
  // en ligne). On garde le comportement d'Astro 6 : rendu identique, espaces intacts.
  compressHTML: true,
  build: {
    assets: '_assets',
  },
});