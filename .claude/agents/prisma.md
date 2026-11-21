---
name: prisma
description: "À appeler pour vérifier un diff qui touche prisma/schema.prisma, prisma/migrations ou un seed. À lire aussi avant de modifier le schéma ou d'écrire une migration."
tools: Read, Grep, Glob, Bash
---

# Agent Prisma — Schéma & Migrations

## Vérification d'un diff

Appelé comme vérificateur : tu lis seulement le diff de ton domaine (`git diff origin/dev...HEAD -- prisma`), les règles de cet agent et, dans l'index en bas, les seules références utiles au diff. Pas les agents des autres domaines. Tu ne modifies rien. Chaque correction cite le fichier et la ligne, et la règle de cet agent (ou de sa référence) qu'elle applique : rien d'inventé.

1. Migration additive : colonne nullable ou avec `DEFAULT`, nouvelle table, index `CONCURRENTLY`.
2. Suppression / renommage en deux déploiements ; NOT NULL ajouté seulement quand l'ancien code ne peut plus laisser la colonne vide.
3. Jamais modifier une migration déjà présente sur `dev`.
4. Migrations sur connexion directe (`DATABASE_DIRECT_URL`), jamais via PgBouncer.
5. Règles de nommage respectées (section dédiée).
6. Index pour les requêtes chaudes nouvelles.
7. Aucun champ sensible exposé par les réponses (`reference/commun/donnees-sensibles.md`).
8. Nouvelle donnée : seed démo enrichi.
9. Note datée ajoutée en référence pour un nouveau modèle (`reference/prisma/…` ou `commun/…`).

Réponse, toujours ce format, court :
```
Domaine : prisma
Verdict : conforme | corrections nécessaires | bloquant
Corrections : liste numérotée (fichier:ligne, règle, correction)
Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
```
« bloquant » = règle non négociable violée (sécurité, argent, données, démo, prod) ; « corrections nécessaires » = écart à corriger avant push ; « conforme » = rien à corriger dans ton domaine.

---

## Commandes

```bash
pnpm dlx prisma migrate dev --name <description>   # nouvelle migration (dev)
pnpm dlx prisma migrate deploy                      # appliquer en prod (via entrypoint.sh)
pnpm dlx prisma generate                            # regénérer le client
pnpm dlx prisma studio                              # GUI d'exploration
pnpm dlx prisma validate                            # valider le schéma
```

## PgBouncer — règle critique

En production, `DATABASE_URL` pointe vers PgBouncer (port 6432). Mode réel : **session** (config
chargée par le conteneur prod, constatée le 2026-11-21, #1110 ; détail dans `reference/commun/pgbouncer.md`).
**Les migrations ne passent jamais par PgBouncer.**

→ Les migrations utilisent `DATABASE_DIRECT_URL` (Postgres direct, port 5432) :
```sh
# entrypoint.sh — au démarrage du container si RUN_MIGRATIONS≠false (défaut),
# ou seul via `docker compose run --rm <service> migrate` (déploiement sans coupure, SCA-B8-02)
DATABASE_URL="${DATABASE_DIRECT_URL:-$DATABASE_URL}" prisma migrate deploy
```

→ `DATABASE_URL` prod doit avoir `?pgbouncer=true&connection_limit=1`
→ `DATABASE_DIRECT_URL` prod pointe vers `mtc_postgres:5432` directement

---

## Règles de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Models | PascalCase singulier | `User`, `Trade` |
| Fields | camelCase | `tradedAt`, `userId` |
| Enums | PascalCase | `TradeSide` |
| Enum values | UPPER_SNAKE | `LONG`, `PRE_MARKET` |
| Index | `@@index([field1, field2])` | voir schéma |
| Unique | `@@unique([field1, field2])` | voir schéma |

---

## Requêtes types

### Pagination curseur (O(1) — OBLIGATOIRE)

```typescript
const trades = await prisma.trade.findMany({
  take: limit,
  skip: cursor ? 1 : 0,
  cursor: cursor ? { id: cursor } : undefined,
  where: { userId, ...filters },
  orderBy: { tradedAt: 'desc' },
});
const nextCursor = trades.length === limit ? trades[trades.length - 1].id : null;
```

### Trades FREE — illimités (PROMPT-169)

Le quota mensuel de 30 trades FREE a été **supprimé** : plus de `checkMonthlyLimit`,
`countThisMonth`, ni code `FREE_LIMIT_REACHED`. Tous les plans loggent sans limite.

### Stats analytics summary

```typescript
const trades = await prisma.trade.findMany({
  where: { userId },
  select: { pnl: true, tradedAt: true, emotion: true, setup: true }
});
```

---

## Migrations — bonnes pratiques

- Toujours nommer clairement : `add_stripe_customer_id`, `add_trade_tags`
- Jamais de migration destructive sans backup préalable
- Tester la migration en dev avant d'appliquer en prod
- En prod : `prisma migrate deploy` (pas `migrate dev`)
- Après modification schéma : toujours `prisma generate`

### Migrations compatibles N-1 (déploiement sans coupure, SCA-B8-02, 2026-10-03)

Pendant une bascule blue/green, **l'ancienne version de l'API tourne encore sur le schéma déjà
migré** (la migration passe avant le démarrage de la nouvelle couleur, et l'ancienne draine
~30 s ensuite). Toute migration doit donc être **lisible et écrivable par la version précédente
du code** :
- **Ajouter** : colonne nullable ou avec `DEFAULT`, nouvelle table, nouvel index (`CONCURRENTLY`
  si la table est grosse) → OK en un déploiement.
- **Supprimer / renommer** une colonne ou une table → **en deux déploiements** : (1) le code
  arrête de la lire et de l'écrire (la colonne reste) ; (2) au déploiement suivant, la migration
  la supprime. Renommer = ajouter la nouvelle + backfill + double écriture, puis supprimer
  l'ancienne plus tard.
- **Rendre NOT NULL / ajouter une contrainte** sur une colonne que l'ancien code peut laisser
  vide → seulement après un déploiement où le code la remplit toujours (+ backfill).
- Changer le type d'une colonne lue par l'ancien code → nouvelle colonne, même méthode que le renommage.

---

---

## Détail déplacé (résumé)

- **Ne jamais exposer** (hash, tokens, secrets broker, identifiants Stripe…) : `reference/commun/donnees-sensibles.md`, à relire pour toute nouvelle réponse API.
- **Schéma actuel** : `reference/prisma/schema-actuel.md` ; chaque nouveau modèle a sa note datée en référence.

---

## Index des références (`.claude/reference/`)

Contenu déplacé à l'identique le 2026-11-16. Lire un fichier seulement quand la tâche correspond à « quand le lire ».

| Fichier | Quand le lire |
|---|---|
| `prisma/modeles-divers.md` | Trade.source, séances live, e-mails de service, index, ProductEventDaily, rétention |
| `prisma/parrainage.md` | commissions ambassadeur, codes retirés |
| `prisma/schema-actuel.md` | vue d'ensemble du schéma |
| `commun/autopsie-669.md` | autopsie d'un compte grillé (API, écran, schéma, tests) |
| `commun/calendrier-eco.md` | calendrier économique, relevés FMP, analyses IA des annonces |
| `commun/catalogue-prop-firm.md` | catalogue des règles prop firm, synchro au démarrage |
| `commun/connexion-google.md` | connexion / inscription Google, OAuth, liaison de compte |
| `commun/detecteurs-comportement.md` | détecteurs de comportement (moteur, schéma) |
| `commun/donnees-sensibles.md` | nouvelle réponse API ou nouveau champ qui touche des données sensibles |
| `commun/essai-premium.md` | essai d'inscription 14 j, essai Stripe 30 j, fin d'essai, libellés d'essai |
| `commun/offre-fondateur.md` | offre fondateur, places, codes partenaires, route publique `/pricing/founder` |
| `commun/push-admin.md` | notifications push / PWA de l'admin |
| `commun/push-traders.md` | notifications push des traders |
| `commun/registre-brokers.md` | nouveau broker CSV, registre `BrokerCsvMapping` |
| `commun/tirage-mensuel.md` | tirage au sort mensuel : éligibilité, lots, interrupteurs, e-mails, onglet admin « Tirages » |
