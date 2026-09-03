# Agent Astro — landing-mytradingcoach

## Stack
Astro 6 · Tailwind 4 · Static output · servi sur le VPS (conteneur nginx:alpine derrière Traefik,
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
├── pages/
│   ├── index.astro              ← landing principale
│   ├── mentions-legales.astro
│   ├── confidentialite.astro
│   └── cgu.astro
├── content/
│   └── blog/                   ← articles Markdown SEO
│       ├── journal-trading-debutant.md
│       ├── psychologie-trading.md
│       ├── revenge-trading.md
│       ├── win-rate-trading.md
│       └── journal-trading-crypto.md
├── components/
│   ├── Hero.astro
│   ├── Features.astro
│   ├── Pricing.astro
│   ├── FAQ.astro
│   ├── Testimonials.astro
│   └── Footer.astro
└── layouts/
    └── Layout.astro             ← meta SEO, fonts, analytics
```

---

## Compliance NinjaTrader Ecosystem (PROMPT-201)

MyTradingCoach est référencé dans l'écosystème NinjaTrader, ce qui impose 4 avertissements
au texte **non modifiable** (source : `Ninja Trader/3. Disclaimers_VF.docx`, hors dépôt) :

| Avertissement | Où |
|---|---|
| Risques · Performances hypothétiques · Live Trade Room · Témoignages | `src/pages/disclaimer.astro`, section 7 |

Règles :
- **Ne jamais paraphraser, résumer ni tronquer** ces 4 textes — ce sont des mentions réglementaires
  imposées. Toute retouche doit repartir de la `.docx`.
- Le `footer` doit conserver les mentions clés (risque de perte, performances passées,
  résultats hypothétiques) + le lien vers `/disclaimer`.

### Wordmark NinjaTrader

- Assets : `public/ninjatrader/` — wordmark `NinjaTrader_Wordmark_color_RGB.png` (2376×300, `#FF4200`
  sur transparent) + 5 bannières publicitaires (`ninjatrader-banner-*.png`).
- Affiché dans `Footer.astro` (`.footer-eco`) : hauteur 24 px desktop / 20 px mobile, `width:auto`,
  `aspect-ratio:2376/300` (zéro CLS), `object-fit:contain`. **Ne pas recolorer, déformer ni rogner.**
- Les bannières ne sont **pas utilisées** : ce sont des créatives publicitaires avec CTA « Learn More »,
  elles supposent un lien d'affiliation actif.
- `NINJATRADER_URL` dans `Footer.astro` est un **placeholder à `null`** : tant qu'il vaut `null`, le
  wordmark s'affiche sans lien. Ne pas y coder un lien d'affiliation non validé.

---

## Pricing — limites IA à afficher

Dans la section pricing PREMIUM, mentionner les limites de façon positive :

```
✨ IA Insights (1 analyse toutes les 4h)
💬 Chat Coach IA (jusqu'à 50 messages/jour)
📅 Weekly Debrief automatique chaque dimanche
```

Formulation : jamais "limité à", toujours "jusqu'à" ou entre parenthèses en petit.

---

## SEO — Frontmatter blog obligatoire

```markdown
---
title: "Titre avec mot-clé principal"
description: "Description 155 caractères max avec mot-clé"
publishDate: 2026-04-01
tags: ["trading", "journal", "psychologie"]
draft: false
---
```

CTA en fin de chaque article :
```markdown
**Essaie MyTradingCoach gratuitement →** [Commencer maintenant](https://app.mytradingcoach.app/register)
```

---

## Articles blog SEO cibles

| Fichier | Mot-clé principal |
|---|---|
| `journal-trading-debutant.md` | journal de trading débutant |
| `psychologie-trading.md` | psychologie trading biais cognitifs |
| `revenge-trading.md` | revenge trading (faible concurrence) |
| `win-rate-trading.md` | win rate trading calculer |
| `journal-trading-crypto.md` | journal trading crypto 2026 |

---

## Package.json landing

```json
{
  "dependencies": {
    "@astrojs/sitemap": "^3.7.2",
    "astro": "^6.1.1",
    "tailwindcss": "^4.2.2"
  },
  "devDependencies": {
    "@astrojs/check": "^0.9.4",
    "@tailwindcss/vite": "^4.2.2",
    "typescript": "^5.8.3"
  }
}
```

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
