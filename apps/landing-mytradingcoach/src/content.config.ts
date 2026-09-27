import { defineCollection } from 'astro:content';
// Astro 7 : `z` exporté par astro:content est déprécié → import depuis astro/zod.
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

/**
 * Blog : UN fichier Markdown par article (`src/content/blog/<slug>.md`), le slug = nom du fichier.
 * Rendu par `pages/blog/[slug].astro`, liste générée par `pages/blog/index.astro`.
 * Le corps peut contenir du HTML ; lien vers l'app : `href="{APP_URL}/register"` (remplacé au rendu).
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    /** Titre de l'onglet et des résultats Google, s'il diffère du titre affiché. */
    seoTitle: z.string().optional(),
    description: z.string(),
    publishDate: z.date(),
    updatedDate: z.date().optional(),
    tags: z.array(z.string()),
    author: z.string().default('MyTradingCoach'),
    image: z.string().optional(),
  }),
});

export const collections = { blog };
