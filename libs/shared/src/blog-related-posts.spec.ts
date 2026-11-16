import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { relatedBlogPosts, type BlogPostRef } from './blog-related-posts';

const post = (slug: string, tags: string[], date: string): BlogPostRef => ({ slug, title: slug.toUpperCase(), tags, publishDate: new Date(date) });

describe('relatedBlogPosts', () => {
  const posts = [
    post('a', ['prop firm', 'journal'], '2026-07-01'),
    post('b', ['Prop Firm', 'journal'], '2026-06-01'),
    post('c', ['journal'], '2026-08-01'),
    post('d', ['crypto'], '2026-09-01'),
    post('e', ['prop firm'], '2026-05-01'),
  ];

  it('classe par tags communs (sans la casse), puis du plus récent au plus ancien', () => {
    expect(relatedBlogPosts('a', posts, 3).map((p) => p.slug)).toEqual(['b', 'c', 'e']);
  });

  it("n'inclut jamais l'article lui-même et complète par les plus récents", () => {
    const r = relatedBlogPosts('d', posts, 3).map((p) => p.slug);
    expect(r).not.toContain('d');
    expect(r).toEqual(['c', 'a', 'b']);
  });

  it('respecte la limite, 0 ou négative comprise', () => {
    expect(relatedBlogPosts('a', posts, 2)).toHaveLength(2);
    expect(relatedBlogPosts('a', posts, 0)).toEqual([]);
    expect(relatedBlogPosts('a', posts, -1)).toEqual([]);
  });

  it('ordre stable à égalité (slug), et article inconnu sans erreur', () => {
    const twins = [post('z', ['x'], '2026-01-01'), post('y', ['x'], '2026-01-01'), post('w', ['x'], '2026-01-01')];
    expect(relatedBlogPosts('w', twins, 2).map((p) => p.slug)).toEqual(['y', 'z']);
    expect(relatedBlogPosts('inconnu', twins, 5)).toHaveLength(3);
  });
});

/**
 * SEO de la landing (#1071, phase 1). La landing n'a pas de suite de tests : invariants lus sur disque.
 */
describe('landing · SEO (#1071)', () => {
  const landing = resolve(import.meta.dirname, '../../../apps/landing-mytradingcoach');
  const read = (path: string) => readFileSync(resolve(landing, path), 'utf8');

  it('robots.txt ne bloque rien et déclare le sitemap', () => {
    const robots = read('public/robots.txt');
    expect(robots).not.toMatch(/^\s*Disallow:\s*\S/m);
    expect(robots).toMatch(/^User-agent: \*$/m);
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'bingbot']) {
      expect(robots).toContain(`User-agent: ${bot}`);
    }
    expect(robots).toContain('Sitemap: https://www.mytradingcoach.app/sitemap-index.xml');
  });

  it("chaque article a son image de partage (sinon : node tools/scripts/generate-og-images.mjs)", () => {
    const slugs = readdirSync(resolve(landing, 'src/content/blog')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) expect(existsSync(resolve(landing, `public/og/blog/${slug}.jpg`)), slug).toBe(true);
    for (const f of ['default', 'prop-firm', 'journal-trading-prop-firm', 'blog', 'ambassadeur']) {
      expect(existsSync(resolve(landing, `public/og/${f}.jpg`)), f).toBe(true);
    }
  });

  it("données structurées : ni note ni avis inventés, prix lus dans @mtc/shared", () => {
    const schema = read('src/data/schema.ts');
    // Propriété ou type JSON-LD réellement émis (les commentaires qui les interdisent ne comptent pas).
    const rating = /["']?aggregateRating["']?\s*:|["']@type["']\s*:\s*["'](AggregateRating|Review)["']/;
    for (const f of ['src/data/schema.ts', 'src/layouts/Base.astro', 'src/layouts/BlogPost.astro', 'src/pages/prop-firm.astro', 'src/pages/journal-trading-prop-firm.astro']) {
      expect(read(f), f).not.toMatch(rating);
    }
    expect(schema).toContain("import { PREMIUM_PRICE_EUR } from '@mtc/shared'");
    expect(schema).not.toMatch(/price:\s*'(?!0')\d/);
  });

  it('/prop-firm est indexable et dans le sitemap ; /accueil et `/` restent dehors', () => {
    expect(read('src/pages/prop-firm.astro')).not.toMatch(/^\s*noindex\s*$/m);
    const config = read('astro.config.mjs');
    expect(config).not.toMatch(/\\\/prop-firm\\\/\?\$\/\.test\(page\)\) return false/);
    expect(config).toContain("if (/\\/accueil\\/?$/.test(page)) return false;");
    expect(config).toContain("if (!MULTI_ACCOUNTS && page.includes('/journal-trading-prop-firm')) return false;");
    expect(config).toContain("if (!REFERRAL && page.includes('/ambassadeur')) return false;");
  });
});
