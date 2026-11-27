# PROMPT-1195 : token texte sur --primary

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #1195 : Token texte sur --primary (#fff, 51 occurrences)

Relevé par le vérificateur design pendant #1189 (hors périmètre, dette, pas un bug).

Le texte blanc sur fond `--primary` / `--primary-hover` est écrit en dur (`color: #fff`) dans environ 51 endroits de l'app (boutons primaires, premium-lock, plan-modal, demo-cta, not-found…). La règle design dit « jamais de couleur en dur » ; l'exception est seulement documentée dans `theme.css` (contraste 5,2:1 sur `--primary`).

À faire : un token dédié (ex. `--text-on-primary`) dans `theme.css`, puis remplacer les `#fff` / `white` posés sur `--primary` ; mettre à jour les specs qui figent `#fff` comme seule exception (ex. `premium-lock.component.spec.ts`).

Vérificateurs : angular, design, tests.
