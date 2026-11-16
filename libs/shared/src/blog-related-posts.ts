/**
 * Articles liés d'un article de blog (maillage interne, SEO phase 1) : pur, sans Astro, calculé au
 * build. Ordre : nombre de tags communs (sans la casse), puis article le plus récent, puis slug
 * (comparaison simple, indépendante de la locale de la machine de build). Complète avec les plus récents si les tags ne suffisent pas.
 */
export interface BlogPostRef {
  slug: string;
  title: string;
  tags: readonly string[];
  publishDate: Date;
}

export function relatedBlogPosts(slug: string, posts: readonly BlogPostRef[], limit: number): { slug: string; title: string }[] {
  const self = posts.find((p) => p.slug === slug);
  const own = new Set((self?.tags ?? []).map((t) => t.toLowerCase()));
  return posts
    .filter((p) => p.slug !== slug)
    .map((p) => ({ p, shared: p.tags.filter((t) => own.has(t.toLowerCase())).length }))
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        b.p.publishDate.getTime() - a.p.publishDate.getTime() ||
        (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
    )
    .slice(0, Math.max(0, limit))
    .map(({ p }) => ({ slug: p.slug, title: p.title }));
}
