# Suites de tests de l'API (unitaire et intégration)

> Contenu déplacé à l'identique depuis `.claude/agents/tests.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : tests.md · Deux suites côté API : unitaire et intégration · 2026-08-16 -->
> **Origine** : `tests.md` · « Deux suites côté API : unitaire et intégration » · 2026-08-16

## Deux suites côté API : unitaire et intégration

| Suite | Fichiers | Config | Services | Où |
|---|---|---|---|---|
| Unitaire | `src/**/*.spec.ts` | `vitest.config.ts` | aucun (mocks) | `pnpm nx test api-mytradingcoach` |
| Intégration | `src/**/*.int-spec.ts` | `vitest.integration.config.mts` | Postgres + Redis | job CI `integration-api` (« Tests d'intégration API », toutes les specs, pas seulement le parrainage) |

`*.int-spec.ts` **ne matche pas** `*.spec.ts` : les deux suites ne se mélangent jamais.

### Bootstrap des `*.int-spec.ts` : TOUJOURS `createIntegrationApp()` (PROMPT-209)

Tout `*.int-spec.ts` qui démarre `AppModule` passe par
`src/test/integration-app.helper.ts`, **jamais** par un
`Test.createTestingModule({ imports: [AppModule] })` direct :

```ts
let app: INestApplication;
let baseUrl: string;
let resend: ResendMock; // optionnel : pour vérifier qu'un email a été DÉCLENCHÉ

beforeAll(async () => {
  ({ app, baseUrl, resend } = await createIntegrationApp());
  // besoins spécifiques : createIntegrationApp({ configure: (b) => b.overrideProvider(…)…,
  //                                              setup: (app) => { app.use(…); app.setGlobalPrefix(…) } })
}, 120_000);
// expect(resend.sendWelcomeFree).toHaveBeenCalledWith(expect.objectContaining({ to: email }));
```

Pourquoi : en local la suite lit le `.env` du développeur, qui porte une **vraie clé
Resend** — chaque run envoyait de vrais emails (inscription, reset…) et consommait le
quota. Le helper remplace `ResendService` par un double dérivé de son **prototype** (toute
nouvelle méthode est neutralisée d'office, aucune liste à maintenir). Par défaut il reproduit
l'ancien bootstrap : `rawBody`, préfixe `api`, `init`, `listen(0)`.

Deux filets, verrouillés par `src/test/resend-neutralized.int-spec.ts` :
- **exécution** : `src/test/integration.setup.ts` (setupFiles de la config d'intégration)
  remplace le SDK `resend` par une classe qui **lève à la construction**. Un spec qui
  oublierait le helper échoue avec un message qui le nomme. Volontairement indépendant de
  `NODE_ENV` : en local la suite tourne avec `NODE_ENV=development` (le `.env` racine).
- **statique** : le spec lit tous les `*.int-spec.ts` et échoue s'il trouve un bootstrap
  direct d'`AppModule`, en nommant le fichier.

Même logique pour tout futur service à effet externe réel (autre fournisseur d'email,
SMS…) : le neutraliser dans le helper, pas fichier par fichier.

**Quand l'intégration est nécessaire, et pas seulement confortable** : dès que le
comportement testé dépend de ce que Prisma renvoie *réellement*. Un double Prisma
répond ce qu'on lui dit quel que soit l'`include` — il ne peut donc pas prouver qu'un
`include` est correct. Cas vécu (PROMPT-200) : `effectiveEmotion` était absent de
`create`/`update` faute d'`include tradeSession`, et un test unitaire vérifiant la
valeur de sortie serait passé au vert avec le bug intact en production. Deux parades,
complémentaires : en unitaire, inspecter l'argument passé à Prisma
(`mock.calls[0][0].include`) ; en intégration, laisser le vrai moteur répondre. Vérifier
qu'un test échoue en réinjectant **chaque moitié** du bug séparément (ici : l'`include`
seul, puis le champ calculé seul).

```bash
# intégration, en local (charge le .env de la racine)
cd apps/api-mytradingcoach
env $(grep -vE '^#|^$' ../../.env | xargs -d '\n') \
  ../../node_modules/.bin/vitest run --config $PWD/vitest.integration.config.mts
```

> `pnpm exec` s'exécute depuis la racine du dépôt (l'API n'est pas un paquet du workspace) : un
> chemin de config relatif y est introuvable (`UNRESOLVED_ENTRY`). D'où le binaire direct et le
> chemin absolu.

> ⚠️ **Un compte broker simulé partagé entre tests.** `tradovate-sync.int-spec.ts` relie chaque
> user de test au même compte Tradovate simulé (`EXT_ACCOUNT`). Depuis la règle « un compte broker
> ne se relie qu'à un seul user » (`dropAlreadyLinked`), le `beforeEach` supprime les connexions des
> users de test, et un test qui relie **plusieurs** users au compte doit le libérer entre deux
> (`releaseExtAccount`). Sans ça, tout test après le premier reçoit `account_already_linked`
> (14 échecs, CI rouge du 27 au 29/09).

> ⚠️ **Aucun appel réel vers Tradovate depuis un test (#859).** Le faux `fetch` des int-spec
> Tradovate doit intercepter **tous** les hôtes `*.tradovateapi.com`, pas seulement `live.` et
> `demo.` : la connexion d'un compte lance l'import d'historique en fond vers `rpt-*`, qui sortait
> sur le vrai réseau avec un jeton factice. Rapports simulés comme le vrai serveur face à un jeton
> factice (401 à corps vide). `tradovate-live.int-spec.ts` refuse en plus tout appel sortant autre
> que l'API locale du test, et son dernier test exige zéro appel refusé.
> `tradovate-sync.int-spec.ts` (clause 2i) : le faux Tradovate lève et note dans `forbidden` toute
> méthode autre que GET (sauf l'instantané de solde, exposé en POST) et toute route `/order/*`,
> `/orderVersion/*`, `/orderStrategy/*` ou `/orderStrategyLink/*` qui n'est pas `list` ; les tests de
> capture du stop (dont la liaison par stratégie, #955) exigent `forbidden` vide.
>
> Capture du stop à l'entrée, cas couverts en unitaire (`tradovate-entry-protection.spec.ts`) : SHORT,
> trailing stop et trailing stop limite, entrée en plusieurs morceaux (même stop et même objectif pour
> chaque morceau), ordres voisins sans lien de stratégie (`no-leg` : aucune inférence par id),
> `entryOrderIdFor` (fill d'achat d'un LONG, de vente d'un SHORT, fill absent → `session-gone`).
> L'int-spec vérifie aussi le R/R calculé sur le chemin par stratégie (10,06). Côté app,
> `journal-rr-unknown.spec.ts` couvre le stop capturé sans objectif (« Objectif non renseigné »,
> bouton « Ajouter l'objectif »).
>
> ⚠️ **Redis local protégé par mot de passe.** Sans `REDIS_PASSWORD`, chaque appel Redis échoue
> en silence (les verrous et pauses retombent sur « pas de Redis ») : `tradovate-sync.int-spec`
> échoue alors 10 fois sur 10 sur la pause de pénalité. Passer la variable du `.env` local, sans
> l'afficher.

> ⚠️ **Schéma local souvent périmé.** Le volume `postgres_local_data` survit aux
> `docker compose down` : une base démarrée après une pause a des migrations de retard,
> et les `int-spec` échouent sur une colonne inexistante (`The column X does not exist`)
> qui n'a rien à voir avec le test. Lancer
> `pnpm exec prisma migrate deploy --config=./prisma/prisma.config.ts` avant la suite.

> ⚠️ **Catalogue prop firm : tables globales, synchronisées au boot.** Chaque `createIntegrationApp()`
> aligne `PropFirm` / `PropFirmPlan` sur le JSON livré. Un test qui synchronise un catalogue modifié
> (`service.sync(files)`) doit remettre la base à l'état livré (`service.sync()` en `afterAll`), sinon
> les autres specs voient un plan désactivé. Le verrou de la synchro se teste en le PRENANT depuis le
> test (`$executeRaw` `pg_advisory_xact_lock`, `$queryRaw` ne sait pas lire le `void` renvoyé) :
> des `sync()` lancés en parallèle dans un même process finissent l'un après l'autre et passent au
> vert même sans verrou (constaté en retirant le verrou).

> ⚠️ **Arrêter toute API lancée à côté avant de jouer la suite d'intégration.** Un autre
> process branché sur le même Redis consomme la file BullMQ « stripe » et traite les jobs
> du test avec SON code : les assertions passent au vert sans rien prouver. Constaté en
> vrai — un sabotage de `processReferral` est resté invisible tant qu'une API tournait.
> En CI il n'y a qu'un process, le problème ne se pose pas.

> **Vrais appels Stripe en mode test : `delete-me-stripe.int-spec.ts`.** Crée de vrais customers
> et abonnements (actif, essai, impayé via une horloge de test `testHelpers.testClocks` avancée de
> 32 jours avec `pm_card_chargeCustomerFail`), supprime le compte par HTTP et vérifie
> l'abonnement `canceled` chez Stripe ; échec simulé par une seconde app dont le `STRIPE_CLIENT`
> porte une clé invalide (vrai 401 Stripe). Il faut la vraie clé `sk_test_` du job CI : avec la
> clé factice de la recette locale, `balance.retrieve()` échoue au démarrage et ses tests sont
> **sautés** (pas en échec). Nettoyage : horloges, customers et produit de test en `afterAll`.
>
> **Séquence de webhooks sans Stripe réel : `stripe-3ds-pause.int-spec.ts`** (#819). `STRIPE_CLIENT`
> remplacé par un faux client (`configure: (b) => b.overrideProvider(STRIPE_CLIENT).useValue(…)`) dont
> `subscriptions.retrieve` renvoie un abonnement modifié à chaque étape ; événements passés à
> `processWebhookEvent` (ids uniques) ; vraie base (places fondateur) et vrai Redis (e-mails « une
> seule fois »). Aucune clé Stripe requise. Modèle pour tout scénario de facturation à plusieurs étapes.
