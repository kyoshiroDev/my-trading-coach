# Agent Astro — landing-mytradingcoach

## Stack
Astro 5 · Tailwind 4 · Static output · Vercel CDN

---

## Règles absolues

- `output: 'static'` — HTML pur, zéro JS client par défaut
- Lire `landing-mytradingcoach.html` avant tout travail — c'est la source de vérité design
- Ne pas inventer de sections, couleurs ou composants
- Reproduire pixel pour pixel le fichier de référence

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
