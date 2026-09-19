import { defineCollection } from 'astro:content';
// Astro 7 : `z` exporté par astro:content est déprécié → import depuis astro/zod.
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.date(),
    updatedDate: z.date().optional(),
    tags: z.array(z.string()),
    author: z.string().default('MyTradingCoach'),
    image: z.string().optional(),
  }),
});

export const collections = { blog };
