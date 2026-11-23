# PROMPT-790 — Journaux de facturation : remplacer l'identifiant d'utilisateur par les identifiants Stripe

## Texte de Greg (2026-11-23)

> relance le commit une fois cette feature fini enchaine sur les autres de la moin urgente a la plus urgente si tu as des question pose les au relecteur et suit ce qu'il te dit

Ordre fixé par le relecteur : #696, puis #825, puis **#790** (#824 bloquée).

## Tâche : issue #790

Relevé en lecture seule le 29/10 (#769). Ces journaux de l'API écrivent l'identifiant interne d'un utilisateur. La règle des journaux veut le nom de l'erreur seulement, jamais d'identifiant, d'e-mail ni de userId.

**À faire :** remplacer l'identifiant d'utilisateur par l'identifiant Stripe (client `cus_…`, abonnement `sub_…`, session `cs_…`) quand il suffit à retrouver le cas, sinon le retirer. Ne rien perdre d'utile au diagnostic.

| Fichier:ligne | Journal |
|---|---|
| `stripe/stripe-billing.service.ts:110` | « Cache hit billing status \| user: » |
| `stripe/stripe-billing.service.ts:224` | « Code … non appliqué : parrainage plus avantageux \| user: » |
| `stripe/stripe-billing.service.ts:545` | « Intervalle changé \| user: » |
| `stripe/stripe-customer.service.ts:42` | « Customer Stripe créé : `<cus>` \| user: » |
| `stripe/stripe-subscription.service.ts:88` | « Sync ignorée \| user: » |
| `stripe/stripe-subscription.service.ts:129` | « Sync \| user: » |
| `stripe/stripe-webhook.service.ts:196` | « Checkout complété \| sub: …, user: » (`client_reference_id`) |
| `stripe/stripe-webhook.service.ts:625` | « Rappel de reconduction non envoyé (user …) » |
| `stripe/stripe-referral.service.ts:108` | id de l'ambassadeur |
| `stripe/stripe-referral.service.ts:140, 143, 171` | id du filleul |
| `stripe/stripe-referral.service.ts:155` | id du parrain |
| `stripe/stripe-referral.service.ts:194` | id du parrain et du filleul |
| `founder-offer/founder-offer.service.ts:311` | « Fondateur n° … \| user » |
| `partner-codes/partner-code.service.ts:322, 333` | « [PARTENAIRE] … \| user: » |

Chemins relatifs à `apps/api-mytradingcoach/src/modules/`. Numéros de ligne relevés sur `dev` le 29/10.

Déjà corrigés : « Checkout créé » (#785) et « Session checkout existante réutilisée » (branche `feat/apercu-emails-essai`).

**Critères :**
- un test par journal modifié vérifie l'absence d'identifiant d'utilisateur ;
- une contre-épreuve par test ;
- un commit par fichier.

Priorité basse.

