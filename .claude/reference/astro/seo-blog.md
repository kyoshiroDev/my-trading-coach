# Articles de blog SEO cibles

> Contenu déplacé à l'identique depuis `.claude/agents/astro.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : astro.md · Articles blog SEO cibles · 2026-04-25 -->
> **Origine** : `astro.md` · « Articles blog SEO cibles » · 2026-04-25

## Articles blog SEO cibles

| Fichier (`src/content/blog/`) | Mot-clé principal |
|---|---|
| `journal-trading-debutant.md` | journal de trading débutant |
| `psychologie-trading.md` | psychologie trading biais cognitifs |
| `revenge-trading.md` | revenge trading (faible concurrence) |
| `win-rate-trading.md` | win rate trading calculer |
| `journal-trading-crypto.md` | journal trading crypto 2026 |

<!-- Ajout : PROMPT-seo-visibilite-ia, phase 2 · 2026-11-16 -->
## Format d'un article (phase 2 SEO, 2026-11-16)

- **Réponse directe** en tête : un paragraphe en gras de deux phrases au plus qui répond à la question du titre.
- **FAQ** : champ `faq` du frontmatter (3 à 5 vraies questions). `BlogPost.astro` l'affiche en bas
  de l'article (« Questions fréquentes ») et la reprend mot pour mot dans le JSON-LD `FAQPage`.
  Ne pas écrire de FAQ dans le corps en plus (doublon).
- **Sources** : champ `sources` (titre, URL officielle, date de consultation) pour chaque fait affirmé
  (calendrier d'une publication, étude, règle). Affichées en bas de l'article. Pas de source vérifiable
  → reformuler sans le fait ou le chiffre.
- **Chiffres** : jamais de statistique « interne » ou « observée chez nos utilisateurs » sans source
  publiée. Un chiffre d'illustration est marqué « exemple » ou « exemple fictif ».
- **AMF (#881)** : ni « rentable », ni « profitable », ni « edge », ni promesse de résultat, ni
  prévision de marché, ni consigne d'achat ou de vente. Les règles de discipline sont présentées
  comme des exemples à adapter.
- **Plateformes** : aucune autre que NinjaTrader / Tradovate (contexte-com).
- **Fonctions du produit** : dire « en Premium » pour ce qui l'est (`PLAN_BENEFITS`,
  `reference/plans/matrice-features.md`).
- **Typographie** : espace insécable avant `:` `;` `!` `?` `%`, pas de tiret long, pas de `style="…"`.
- **updatedDate** : date réelle de la dernière modification du fond.
- Vérifié par `libs/shared/src/blog-related-posts.spec.ts` (updatedDate, FAQ 3 à 5, vocabulaire
  interdit, plateformes, style inline, tiret long).

<!-- Ajout : PROMPT-seo-visibilite-ia, phase 5 · 2026-11-17 -->
## Brouillons d'articles (phase 5 SEO, 2026-11-17)

- Champ `draft: true` dans le frontmatter : l'article n'est JAMAIS publié (exclu de `/blog/<slug>`, de la
  liste `/blog`, des articles liés, du sitemap et des images de partage). Le blog publie toute date telle
  quelle, une date future ne suffit donc pas à cacher un article.
- Publier un brouillon = décision de Greg : retirer `draft: true`, mettre `publishDate`/`updatedDate` réels,
  relancer `node tools/scripts/generate-og-images.mjs`, revérifier les chiffres et sources.
- Pages hors blog en préparation (ex. comparatif concurrents) : dans `maquettes/` à la racine (gitignoré,
  jamais commité : le dépôt GitHub est public).
- Vérifié par `libs/shared/src/blog-related-posts.spec.ts` (filtre `!data.draft`, aucune image de partage).
