# E2E `app-mytradingcoach` — Playwright

```bash
pnpm nx e2e app-mytradingcoach-e2e                      # tout
pnpm exec playwright test 11-referral-ambassador        # une spec
```

La config charge automatiquement le `.env` de la racine (hors CI, sans écraser une
variable déjà exportée). En CI, les secrets viennent du workflow.

---

## Spec `11-referral-ambassador` — paiement Stripe et commission 20 %

Teste la chaîne complète : inscription du filleul via `?ref=CODE` → checkout →
paiement → webhook → commission créditée à l'ambassadeur.

### Prérequis

| Élément | Pourquoi |
|---|---|
| API lancée (`pnpm nx serve api-mytradingcoach`) | register, checkout, webhook |
| App lancée (`pnpm nx serve app-mytradingcoach`) | parcours d'inscription (auto via `webServer`) |
| Base joignable (`DATABASE_URL`) | setup, assertions, nettoyage |
| **Redis joignable (`REDIS_URL`)** | **le webhook enqueue, le worker écrit la commission** |
| `STRIPE_SECRET_KEY=sk_test_…` | **clé de TEST obligatoire** |
| `STRIPE_WEBHOOK_SECRET=whsec_…` | signature du webhook |
| `STRIPE_PREMIUM_PRICE_MONTHLY_V2` | prix Premium mensuel de test |

> **Redis n'est pas optionnel.** `handleWebhook` se contente de valider la signature
> puis d'enqueuer dans BullMQ, et répond `200`. C'est `StripeProcessor` qui appelle
> `processReferral` et écrit la commission. Sans Redis ni worker, le webhook répond
> `200` et **aucune commission n'apparaît jamais** : le symptôme ressemble à un bug
> produit alors que c'est l'infra de test qui manque.

Si un prérequis manque, le test **skippe** avec la raison affichée. Il ne passe
jamais au vert sans avoir réellement vérifié la commission.

> ⚠️ Le test refuse de démarrer si `STRIPE_SECRET_KEY` ne commence pas par
> `sk_test_`. Aucun test de paiement ne doit toucher au LIVE.

### Les deux modes

Variable `E2E_STRIPE_MODE`, le mode retenu est loggé au début du run.

#### `webhook` (défaut) — déterministe

Ne va pas sur la page Stripe : rejoue un `invoice.payment_succeeded` **signé**
directement sur `/api/billing/webhook`. Pas besoin de `stripe listen`.

```bash
pnpm exec playwright test 11-referral-ambassador
```

Teste la vraie logique de commission (`processReferral`), avec un montant maîtrisé
(49 € → 9,80 €). Ne vérifie pas le passage `PREMIUM` du filleul, qui dépend d'un
abonnement Stripe réel (`syncSubscription`) : cette assertion n'est faite qu'en mode `ui`.

#### `ui` — parcours réel ✅ validé

Chrome remplit la carte de test `4242 4242 4242 4242` sur la page Stripe hébergée.
**Exige `stripe listen`**, sinon le webhook n'atteint jamais `localhost` : le paiement
« réussit » à l'écran et **aucune commission n'est créée**.

Dans un terminal séparé, avant le test — noter le port **3001**, celui de l'API dev :

```bash
stripe listen --forward-to http://localhost:3001/api/billing/webhook
```

> Si la CLI répond `api_key_expired`, sa clé stockée a expiré. Plutôt qu'un
> `stripe login` interactif, lui passer directement la clé de test :
> `stripe listen --api-key "$STRIPE_SECRET_KEY" --forward-to …`

La CLI affiche un `whsec_…`. Il doit être **celui que lit l'API** : `STRIPE_WEBHOOK_SECRET`
du `.env` racine (`.env.development` / `.env.local` ne portent que les adresses DB/Redis).
S'il diffère, le mettre à jour dans `.env` et relancer l'API.

```bash
E2E_STRIPE_MODE=ui pnpm exec playwright test 11-referral-ambassador
```

**Le piège de l'essai gratuit.** `createCheckoutSession` accorde 30 jours d'essai à
tout mensuel dont `trialUsed` est faux. La page affiche alors « Total dû aujourd'hui :
0,00 € » : aucune facture n'est payée, `processReferral` sort sur `amountPaid <= 0`, et
**aucune commission n'est créée**. Le test force donc `trialUsed: true` sur le filleul
avant le checkout, uniquement en mode `ui`. Sans ça, l'échec serait incompréhensible.

Les champs carte sont ciblés par **libellé accessible** (`Numéro de carte`,
`Date d'expiration`, `Code de sécurité`), en français car la session est créée avec
`locale: 'fr'`. Ils ne sont **pas** dans un iframe `__privateStripeFrame` : celui-ci
n'héberge que les boutons Apple Pay / Link.

En cas d'échec, le message distingue « webhook non livré » (infra) d'une commission
absente ou fausse (produit).

---

## Deux pièges vérifiés dans le code

**1. L'événement déclencheur est `invoice.payment_succeeded`, pas
`checkout.session.completed`.** C'est lui qui appelle `processReferral`
(`stripe.service.ts`). Un webhook `checkout.session.completed` ne crée aucune
commission — un test bâti dessus passerait sans rien vérifier.

**2. `stripe trigger invoice.payment_succeeded` ne suffit pas.** La commande
fabrique un customer Stripe arbitraire, alors que `processReferral` retrouve le
filleul par son `stripeCustomerId`. D'où la forge d'un événement signé portant le
vrai customer, dans `helpers/stripe-checkout.helper.ts`.

**3. Le traitement est asynchrone.** Voir l'encadré Redis ci-dessus : un `200` sur
le webhook ne veut pas dire que la commission existe. D'où le polling, jamais un
`sleep` fixe.

**4. Rejouer le même `event.id` ne fait rien.** `markEventAsProcessing` déduplique.
Les événements forgés portent un id horodaté unique par run.

---

## Données de test

Emails préfixés `e2e-referral-` + suffixe horodaté : un run n'entre jamais en
collision avec un autre. `afterAll` supprime users, commissions et rewards du run.
Les rows enfants (trades, setups…) partent en cascade ; `ReferralCommission` et
`ReferralReward` n'ont pas de cascade et sont supprimées explicitement.

L'ambassadeur est créé par le vrai `register` puis promu `AMBASSADOR` via Prisma :
le rôle est **indispensable**, sans lui `processReferral` part sur la branche
« mois offert » et ne crée aucune commission.