---
name: astro
description: "À appeler pour vérifier un diff qui touche apps/landing-mytradingcoach (pages, composants Astro, blog, SEO, GA4). À lire aussi avant de coder dans la landing."
tools: Read, Grep, Glob, Bash
---

# Agent Astro — landing-mytradingcoach

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- apps/landing-mytradingcoach`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Prix et durées depuis `@mtc/shared`, jamais en dur.
2. Liens vers l'app via `${APP_URL}` (jamais l'URL de prod en dur).
3. NinjaTrader : « Référencé dans l'écosystème NinjaTrader » seulement, jamais « partenaire officiel » ni « compatible NinjaTrader », aucun autre courtier nommé, Tradovate en texte seul sans logo.
4. Aucune promesse de gain ; textes alignés sur `.claude/contexte-com.md`.
5. `/prop-firm` jamais supprimée ni déplacée avant fin novembre 2026.
6. JSON-LD : jamais d'`aggregateRating` sans avis vérifiables.
7. Pas de `style="…"` : classes dans le `<style>` du composant.
8. Liens d'action avec `data-ga-event` ; GA4 seulement après consentement (`reference/astro/cookies-ga4.md`).
9. Article de blog : frontmatter complet (section « SEO — Frontmatter blog obligatoire »).
10. Checklist SEO avant deploy respectée (section dédiée).
11. Vocabulaire du drawdown : `DRAWDOWN_LABELS` de `@mtc/shared`.

Réponse, toujours ce format, court :
```
Domaine : astro
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

## Stack
Astro 7 · CSS propre aux composants (Tailwind installé mais **inutilisé** : à retirer dès que le
réseau permet de régénérer le lockfile) · Static output · servi sur le VPS (conteneur nginx:alpine derrière Traefik,
rsync depuis GitHub Actions vers `/opt/static/landing-prod`). Plus de Vercel.

---

## Règles absolues

- `output: 'static'` — HTML pur, zéro JS client par défaut
- Le miroir `landing-mytradingcoach.html` a été retiré du dépôt (commit `581875e`) : la source de
  vérité design est le composant `.astro` lui-même, plus les `maquette-*.html` du dossier
  `maquettes/` (gitignoré, local)
- Ne pas inventer de sections, couleurs ou composants

---

## Structure

```
src/
├── config.ts                    ← APP_URL, API_URL, FEATURES (flags de publication)
├── data/
│   ├── faq.ts                   ← FAQ de la home : texte affiché ET JSON-LD FAQPage
│   └── schema.ts                ← JSON-LD (/prop-firm : SoftwareApplication + FAQPage ; autres : Organization + WebSite ; règles : reference/astro/seo-technique.md)
├── content/blog/<slug>.md       ← UN fichier par article (le slug = nom du fichier)
├── content.config.ts            ← schéma du frontmatter blog
├── pages/
│   ├── index.astro              ← page de secours de la redirection `/` → /prop-firm (temporaire, voir plus bas)
│   ├── accueil.astro            ← ancienne home (noindex, hors sitemap) tant que `/` redirige
│   ├── blog/index.astro         ← liste générée depuis la collection (tri par publishDate)
│   ├── blog/[slug].astro        ← rendu d'un article
│   └── cgu, mentions-legales, politique-confidentialite, disclaimer, 404, ambassadeur…
├── components/                  ← sections de la home + mockup/ (maquettes produit de Showcase)
├── layouts/Base.astro           ← meta SEO, JSON-LD, fontes · BlogPost.astro ← gabarit article
└── styles/global.css, legal.css ← variables, utilitaires (.wrap), pages légales (.legal)
```

## Tableau comparatif (`Compare.astro`)

Les lignes sont **une seule source de vérité** (tableau `rows` dans le frontmatter) : le rendu
desktop (MTC Gratuit + MTC Premium + 3 concurrents) et le rendu mobile (Gratuit, Premium, « Les
autres ») en sortent tous les deux, ils ne peuvent pas diverger.

- Ajouter une ligne = un objet dans `rows` : `free` / `premium` (MTC) + `rivals: [FocusPips, TradesViz, Edgely]`.
- MTC est coupé en **deux colonnes Gratuit / Premium**, alignées sur le contrôle d'accès réel de
  l'API (guards, crons, `AccountsService`) — pas de badge « PREMIUM » à côté d'une coche.
- Concurrents : `false` = non mentionné sur le site officiel · `yes('Pro')` = palier minimum où la
  fonction apparaît · `yes()` = proposé, palier non précisé · `txt('…')` = valeur nuancée.
  **Uniquement des pages officielles**, sources listées en commentaire en tête du fichier ; dans le
  doute, trancher en faveur du concurrent (publicité comparative objective et vérifiable).
  Re-vérifier à chaque modification et mettre à jour `UPDATED`.
- La colonne mobile « Les autres » est **calculée** par `merge()`, jamais saisie à la main :
  `✓` seulement si les trois concurrents l'ont · `-` seulement si aucun ne l'a · `partiel` dès que
  c'est mixte. **Ne jamais afficher `-` quand un concurrent propose la fonctionnalité** — ce serait
  une affirmation fausse.
- Valeurs non booléennes (prix) : renseigner `othersLabel` avec une fourchette couvrant les trois.
- Bascule purement CSS : `.c-rival` (masqué < 768px) / `.c-others` (masqué ≥ 768px). Pas de
  `min-width` en mobile — le tableau doit tenir dans le viewport sans scroll horizontal.

---

## Pricing — limites IA à afficher

Dans la section pricing PREMIUM, mentionner les limites de façon positive :

```
✨ IA Insights (1 analyse toutes les 4h)
💬 Chat Coach IA (jusqu'à 50 messages/jour)
📅 Débrief hebdo automatique chaque dimanche
```

Formulation : jamais "limité à", toujours "jusqu'à" ou entre parenthèses en petit.

---

## SEO — Frontmatter blog obligatoire

```markdown
---
title: "Titre affiché avec mot-clé principal"
seoTitle: "Titre de l'onglet / Google (optionnel)"
description: "Description 155 caractères max avec mot-clé"
publishDate: 2026-04-01
updatedDate: 2026-05-01   # date réelle de la dernière mise à jour, alimente lastmod du sitemap
tags: ["trading", "journal", "psychologie"]
faq:                      # 3 à 5 vraies questions, affichées ET reprises dans le FAQPage
  - question: "…"
    answer: "…"
sources:                  # source officielle de chaque fait affirmé (optionnel sans fait chiffré)
  - title: "…"
    url: "https://…"
    consulted: 2026-11-16
---
```

Réponse directe dans les deux premières lignes (paragraphe en gras), aucun chiffre sans source, aucun
vocabulaire de gain : détail dans `reference/astro/seo-blog.md` (vérifié par `blog-related-posts.spec.ts`).

Le corps peut être du Markdown ou du HTML (les articles migrés gardent leur HTML d'origine).

CTA en fin de chaque article :
```markdown
<a href="{APP_URL}/register">Commencer gratuitement</a>
```

---

## Package.json landing

Voir `apps/landing-mytradingcoach/package.json`. À faire quand le réseau le permet (lockfile) :
retirer `tailwindcss` et `@tailwindcss/vite`, aligner TypeScript sur la racine (6.x), ajouter
`eslint-plugin-astro` + `prettier-plugin-astro` (cible `lint` = eslint + `astro check`), et
auto-héberger les fontes (`@fontsource/*`, fin du hack `media="print" onload`).

---

## Checklist SEO avant deploy

- [ ] `<title>` unique sur chaque page
- [ ] `<meta name="description">` présente (155 car. max)
- [ ] `<link rel="canonical">` sur chaque page
- [ ] `robots.txt` présent dans `public/`
- [ ] `sitemap-index.xml` généré par `@astrojs/sitemap`
- [ ] Pas de `noindex` / `nofollow` accidentel
- [ ] LCP < 1.2s
- [ ] CLS < 0.05
- [ ] Images avec `alt` renseigné

---

## Règles de contenu (résumé : détail dans `reference/astro/regles-contenu.md`)

- **Prix** : toujours depuis `@mtc/shared` (jamais en dur).
- **Liens vers l'app** : `${APP_URL}/register`, jamais l'URL de prod en dur.
- **JSON-LD** : jamais d'`aggregateRating` sans avis vérifiables.
- **Vocabulaire du drawdown** : `DRAWDOWN_LABELS` de `@mtc/shared`.
- **Styles** : pas de `style="…"` ; classes dans le `<style>` du composant.
- **Clics CTA → GA4** : tout lien d'action porte `data-ga-event`.
- **NinjaTrader** : « Référencé dans l'écosystème NinjaTrader », jamais « partenaire officiel », aucun autre courtier nommé, Tradovate en texte seul (`reference/astro/compliance-ninjatrader.md`).
- **`/prop-firm`** : ne jamais la supprimer ni changer son URL avant fin novembre 2026 (`reference/astro/prop-firm.md`).

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `astro/compliance-ninjatrader.md` | toute mention NinjaTrader / Tradovate |
| `astro/cookies-ga4.md` | cookies, consentement, GA4 |
| `astro/historique.md` | migration Astro 7, règles de l'audit UX |
| `astro/prop-firm.md` | page `/prop-firm`, redirection de l'accueil |
| `astro/regles-contenu.md` | tout contenu de la landing (prix, liens, JSON-LD, sections de la home, tarifs) |
| `astro/seo-blog.md` | nouvel article de blog |
| `astro/seo-technique.md` | titres, meta, Open Graph, JSON-LD, sitemap, robots.txt, llms.txt, maillage, images de partage |
| `commun/essai-premium.md` | essai d'inscription 14 j, essai Stripe 30 j, fin d'essai, libellés d'essai |
