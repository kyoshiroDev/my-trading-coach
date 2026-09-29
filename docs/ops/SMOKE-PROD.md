# SMOKE-PROD — checklist post-déploiement

> Les E2E (Playwright) et les tests unitaires (Vitest) tournent en local/CI sur une
> DB de test, PAS sur la topologie prod (cluster Redis, Traefik, VPS, Vercel). Ils
> n'attrapent donc pas les bugs prod-only (env vars manquantes, secrets, réseau,
> webhooks Stripe réels, CORS, cache). Cette checklist se fait **à la main, sur la
> prod, après chaque déploiement**. 5 minutes, aucune donnée de test écrite en prod.

URLs prod :
- App : https://app.mytradingcoach.app
- API : https://api.mytradingcoach.app/api
- Landing : https://www.mytradingcoach.app

## Règles
- Utiliser un **compte de test prod dédié** (jamais un vrai client) pour les actions qui écrivent.
- Ouvrir la **console navigateur** (F12) et garder un œil sur les erreurs rouges pendant tout le parcours.
- Si un point échoue → ne pas annoncer le déploiement, rollback ou corriger.

## Checklist (8-10 points)

1. **Landing charge** — `https://www.mytradingcoach.app` répond en 200, le compteur de
   traders s'affiche, aucune erreur console. Vérifier `GET /api/public/stats` → 200.

2. **Login** — connexion avec le compte de test → arrive sur `/dashboard`. Le mauvais
   mot de passe affiche une erreur lisible (pas un 500). Logout → retour login.

3. **Dashboard charge** — KPIs (capital, P&L, win rate), graphe equity et listes se
   chargent. Pas de spinner infini, pas d'erreur réseau (onglet Network sans 4xx/5xx).

4. **Créer un trade** — depuis le Journal, ajouter un trade → il apparaît dans la liste
   et incrémente les stats. Le supprimer ensuite pour ne pas polluer.

5. **Changer de compte met à jour les chiffres** (multi-comptes, tous plans) — le sélecteur
   de compte dans le topbar change le **capital de départ**, le **P&L** et le **nombre de
   trades** sur le Dashboard, et filtre le Journal/Analytics/Sessions. « Tous les comptes »
   → agrégat. (Régressions 104-106.)

6. **Quota comptes** — un FREE ne peut pas créer un 2e compte (CTA upgrade Premium). Un
   Premium a des comptes illimités. (107.)

7. **Checkout Stripe s'ouvre** — depuis Paramètres/Pricing, cliquer « Passer Premium »
   ouvre bien la page de paiement Stripe (mode prod = clés LIVE). NE PAS payer. Vérifier
   juste que la session de checkout se crée (pas d'erreur `create-checkout-session`).
   Si un vrai test de paiement est nécessaire, utiliser une carte de test sur un
   environnement Stripe test, jamais en LIVE.

8. **Webhook Stripe vivant** — dans le dashboard Stripe (prod), onglet Webhooks : les
   derniers events sont en « Succeeded » (pas de 4xx/5xx en boucle). Un abonnement réel
   récent doit avoir basculé l'utilisateur en PREMIUM côté admin.

9. **Débrief charge** (Premium) — la page Weekly Debrief affiche le dernier rapport avec
   ses **onglets** (Vue d'ensemble + un par compte). Pas d'appel IA déclenché par le simple
   chargement (le bouton « Générer » est explicite). (108.)

10. **Calendrier éco** — les events du jour s'affichent. Pour un Premium, l'analyse IA
    bull/bear se déclenche au clic (lazy). Pas d'erreur si l'API éco externe est lente.

## Bonus — santé technique
- `GET /api/public/stats` → 200 (API + DB joignables).
- Pas d'erreur 5xx dans les logs API sur les 5 dernières minutes.
- Redis et la queue Stripe (BullMQ) tournent (les webhooks ne s'empilent pas).
- Certificats TLS valides (Traefik), pas d'avertissement HTTPS.

## Option — smoke Playwright read-only contre la prod
Un petit spec lecture seule peut automatiser les points 1-3 et 10 sans écrire de données :
`BASE_URL=https://app.mytradingcoach.app pnpm nx e2e app-mytradingcoach-e2e --grep @smoke`
(tag `@smoke` à réserver aux specs read-only : chargement de pages publiques, login d'un
compte de test, lecture du dashboard. Aucune création/suppression de données en prod.)
