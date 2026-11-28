# PROMPT-493-chatbot-support : chatbot de support, étapes 1 et 2

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Tri du relecteur (2026-11-26)

« 493 B étapes 1-2 derrière flag »

## Ticket #493

### Idée : chatbot de support MyTradingCoach (app + landing, base locale + Haiku, conversation avec l'admin)

## Idée (révisée le 2026-10-22)
Un **vrai assistant de support**, sur la **landing et dans l'app**, qui répond juste, ne promet rien de faux et passe la main à un humain proprement. Contexte : la newsletter NinjaTrader de mi-novembre va amener plusieurs centaines de traders futures ; MTC n'a aujourd'hui aucune aide dans l'interface.

Remplace la V1 légère précédente (app seule, LLM réservé Premium, plan Starter périmé).

## Résumé
- **Base de connaissances** (`modules/help/kb/`, ~30 entrées Markdown) issue des seules sources de vérité, prix/durées en variables (`{{PREMIUM_MONTHLY}}`, `{{TRIAL_DAYS}}`…), règles prop firms lues dans le catalogue à l'exécution (source + date de relevé).
- **API** `help` : `POST /api/help/ask` (connecté, `@DemoAllowed()`) + `POST /api/public/help/ask` (visiteur). Recherche locale d'abord, repli Haiku (`max_tokens` 400, prompt caching), sinon passage à un humain. **Ouvert à tous** (exception assumée dans `plans.md`) avec garde-fous : 30 msg/j connecté, 10 msg/j par IP hachée visiteur, plafond global Haiku/jour (défaut 500, alerte admin à 80 %). `AiUsageLog` `feature: 'help_chat'`, modèle `HelpQuestion` purgé à 90 j.
- **Widget** commun app (`mtc-help-chat`) + landing (Astro, chargé après affichage) : questions fréquentes selon la page, 👍/👎, « Parler à un humain ».
- **Admin « Support »** : questions sans bonne réponse en premier, tickets, coût Haiku.
- **Conversation à double sens** (type Intercom) : `SupportConversation` / `SupportMessage`, onglet « Messages », pastille non lu, réponses depuis l'admin, e-mails Resend (identité support, 1 / 10 min max), lien sécurisé pour les visiteurs, rattachement au compte.
- **Hors périmètre** : conseil de trading, lecture des données de trading, actions sur le compte, lecture des e-mails entrants.

**Nouvelle feature** → branche `feat/chatbot-support` depuis `origin/beta`, 5 étapes avec arrêt après chacune.

<details>
<summary>Prompt complet</summary>

# PROMPT — Chatbot de support MyTradingCoach (version pro, app + landing)

> **Remplace** `PROMPT-chatbot-aide-support.md` (5/10, jamais lancé, et périmé : il parlait encore du plan Starter et limitait le bot à l'app).
>
> **Contexte (21/10).** Mi-novembre, la newsletter NinjaTrader va amener plusieurs centaines de traders futures sur le site et dans l'app. Les prop firms et les outils sérieux ont tous un support visible, disponible à toute heure. MTC n'a aujourd'hui aucune aide dans l'interface. On veut un **vrai assistant de support**, sur la landing **et** dans l'app, qui répond juste, ne promet rien de faux, et passe la main à un humain proprement.
>
> **C'est une nouvelle fonctionnalité** : branche `feat/chatbot-support` depuis **`origin/beta`** à jour, dans un worktree séparé. Testée sur beta, puis beta → dev → main.

## Règles de travail
- Lis `CLAUDE.md`, puis `nestjs.md`, `angular.md`, `astro.md`, `design.md`, `plans.md`, `security.md`, `prisma.md` et `tests.md`.
- `pnpm` / `pnpm dlx` uniquement. Logger NestJS, jamais `console.log`. Prisma uniquement dans les services. `@if` / `@for`, signals, `inject()`. CSS dans les `.css`.
- **Le travail se fait en 5 étapes, avec un arrêt après chacune** (voir plus bas). Build et tests au vert à chaque étape. Un commit par étape (`feat(help): …`). **Aucun push sans mon « OK push ».**

## Ce que le bot doit faire (et ne jamais faire)

**Il répond** sur MyTradingCoach :
- fonctionnement : connexion Tradovate, relier son plan prop firm, séance (préparation, en direct, débrief), journal, statistiques, débrief de la semaine, détection du tilt, démo ;
- plans : gratuit, Premium, essai, offre fondateur, codes partenaires, parrainage, résiliation, remboursement ;
- compte : mot de passe, Google, suppression du compte, données personnelles, e-mails ;
- **règles des prop firms du catalogue** : « Quelle est la limite journalière de l'Apex 50K ? », « Le drawdown Tradeify est-il suiveur ? ». Il répond **uniquement** avec les valeurs du catalogue, en citant la source et la date de relevé, et rappelle que seules les règles officielles de la firme font foi.

**Il ne fait jamais :**
- de conseil de trading, d'investissement ou de gestion du risque (« dois-je prendre ce trade ? », « quel setup ? ») : il refuse poliment. Dans l'app, il renvoie les Premium vers le coach IA ;
- d'invention : aucun prix, aucune fonctionnalité, aucune règle qui ne soit pas dans sa base. S'il ne sait pas, il le dit et propose de parler à un humain ;
- d'action sur le compte (changer de plan, annuler, supprimer) : il explique où le faire et donne le lien ;
- de lecture des données de trading de l'utilisateur ;
- de changement de rôle : il ignore toute instruction de l'utilisateur qui viserait à le détourner ;
- de mention d'un autre courtier ou de « partenaire officiel » NinjaTrader (règles de conformité de `astro.md`).

**Ton** : français, tutoiement, court (3 à 6 lignes), direct, avec des liens vers la bonne page de l'app quand c'est utile.

## Étape 1 — La base de connaissances (arrêt pour relecture)
C'est elle qui fait la qualité du bot.

- Dossier `apps/api-mytradingcoach/src/modules/help/kb/` : un fichier Markdown par sujet, avec un front-matter (`id`, `title`, `keywords` en français avec variantes, `audience: all | app`, `links`).
- **Sources de vérité uniquement** : la FAQ et les textes de la landing, `PLAN_BENEFITS` et les constantes de `@mtc/shared`, `pricing.const.ts`, `plans.md`, les CGU, la politique de confidentialité et le code réel. **Rien d'inventé.** Ce que tu ne peux pas vérifier, tu ne l'écris pas : liste-le-moi.
- **Aucun prix ni durée en dur** : des variables (`{{PREMIUM_MONTHLY}}`, `{{TRIAL_DAYS}}`, `{{FOUNDER_MONTHLY}}`, `{{FOUNDER_SEATS_LEFT}}`…) remplacées à l'exécution depuis les constantes et la configuration. Un test vérifie qu'aucun montant n'est écrit en dur dans `kb/`.
- **Règles des prop firms** : pas de copie dans la base. Le service lit le catalogue existant à l'exécution, et ne sert que la fiche de la firme ou du plan cité dans la question.
- Une trentaine d'entrées environ, couvrant au moins les sujets de la section « Il répond ».
- **Arrêt** : envoie-moi la liste des entrées (titre et réponse) et la liste des points que tu n'as pas pu vérifier. Je relis avant l'étape 2.

## Étape 2 — L'API (module `help`)
- `POST /api/help/ask` (utilisateur connecté, `JwtAuthGuard`) et `POST /api/public/help/ask` (visiteur de la landing, sans compte). Même service derrière.
- DTO : `message` (1 à 500 caractères), `history` (6 derniers échanges au plus), `page` (chemin de la page, facultatif, pour le contexte).
- **Compte démo** : `@DemoAllowed()` sur la route de l'app, sinon `DemoReadOnlyGuard` la bloque.
- **Fonctionnement :**
  1. **Recherche locale d'abord** : normalisation (minuscules, sans accents ni ponctuation), score par mots-clés et titre, seuil configurable. Si une entrée correspond nettement, on la renvoie **sans appel IA**.
  2. **Sinon, Haiku** avec les 5 entrées les plus proches et, si une firme est citée, sa fiche du catalogue. `max_tokens` 400. Mise en cache du prompt système (`cache_control: ephemeral`). Reprends le modèle Haiku déjà utilisé dans le dépôt (grep), sans l'écrire de mémoire. Jamais d'autre modèle.
  3. **Si rien ne convient** : réponse « Je ne suis pas sûr, je préfère te mettre en relation avec Grégory » et proposition de passer à un humain.
- **Ouvert à tous, gratuits compris, et aux visiteurs de la landing**. Le coût de Haiku est minime, et répondre à tout le monde, c'est le but du support. Mets à jour `plans.md` : le bot de support est une exception assumée à la règle « appel IA = Premium », avec ses garde-fous. Garde-fous :
  - utilisateur connecté : 30 messages par jour (clé Redis `help:calls:{userId}:{jour}`) ;
  - visiteur : 10 messages par jour et par IP hachée, plus un throttle de 10 requêtes par minute ;
  - **plafond global** : nombre maximal d'appels Haiku par jour (variable d'environnement, défaut 500). Au-delà, recherche locale seulement, puis passage à un humain. Alerte dans les notifications admin quand on atteint 80 %.
  - hors prod : réponses simulées, aucun appel réel.
- Chaque appel Haiku passe par `AiUsageLog` avec `feature: 'help_chat'`.
- **Passage à un humain** : `POST /api/help/ticket` (et sa version publique). Champs : e-mail (prérempli si connecté), message, transcription de la conversation. Envoi à `support@mytradingcoach.app` par Resend, avec la transcription, la page et le plan de l'utilisateur. Accusé de réception à l'utilisateur, avec l'identité d'envoi existante (support). Pas d'adresse `hello@` visible. Throttle strict (3 par heure et par IP).
- **Historique des questions** : modèle Prisma `HelpQuestion` (`id`, `userId` facultatif, `anonymous`, `question` tronquée à 500, `source`: `KB | LLM | ESCALATE | TICKET`, `kbId` facultatif, `page`, `createdAt`), avec sa migration. Aucune donnée de trading. Purge au-delà de 90 jours par un cron. Exclure les comptes démo des statistiques (`isDemo: false`).

## Étape 3 — L'interface (arrêt pour captures)
Un même widget pour l'app et la landing, au style « The Terminal » de `design.md`. Aucune couleur en dur.

- **Bouton flottant** en bas à droite, rond, icône de bulle, avec un libellé « Besoin d'aide ? » au survol. Il ne doit jamais masquer le bandeau cookies, la barre de navigation mobile de l'app ni un bouton d'action : décale-le si besoin.
- **Panneau** de 380 × 600 px environ sur ordinateur, **plein écran sur mobile**. Fermeture avec Échap, la croix et le bouton retour sur mobile.
- **Écran d'accueil** :
  - en-tête avec le logo MTC, « Salut 👋 Comment on peut t'aider ? » et un point vert « Réponse instantanée » ;
  - champ « Pose ta question » ;
  - **« Questions fréquentes »** : 5 questions cliquables, différentes selon la page (landing : « C'est gratuit ? », « Comment ça se connecte à Tradovate ? », « Quelles prop firms sont prises en charge ? », « Est-ce que l'app peut passer des ordres ? », « Qu'est-ce que l'offre fondateur ? » ; app : « Comment connecter Tradovate ? », « Comment relier mon plan prop firm ? », « Qu'est-ce qui est Premium ? », « Comment résilier ? », « Comment supprimer mon compte ? ») ;
  - bloc **« Parler à un humain »** : « Écris-nous, Grégory te répond par e-mail sous 24 h » et un lien Discord.
- **Conversation** : bulles, indicateur de saisie, liens cliquables, et sous chaque réponse « Ça t'a aidé ? 👍 / 👎 » (enregistré dans `HelpQuestion`). Un bouton « Parler à un humain » toujours accessible.
- **Formulaire humain** : e-mail, message prérempli avec la dernière question, envoi, puis confirmation.
- **App** : composant `mtc-help-chat` dans `shared/components`, monté une fois dans le shell, présent aussi en démo. **Landing** : composant Astro avec un script léger, chargé **après** l'affichage de la page (aucun impact sur la vitesse), présent sur toutes les pages.
- Pas de suivi : aucune donnée envoyée tant que le visiteur n'a rien écrit. Mets à jour la politique de confidentialité (questions conservées 90 jours, sans donnée de trading).
- Accessibilité : `aria-label`, focus dans le panneau à l'ouverture, navigation au clavier. `data-testid` : `help-button`, `help-panel`, `help-input`, `help-suggestion`, `help-human`.
- **Arrêt** : captures à 390 et 1440 px (accueil du panneau, une conversation, le formulaire humain), sur la landing et dans l'app. Je valide le rendu avant l'étape 4.

## Étape 4 — Admin et finitions
- Page admin **« Support »** (lis `admin-mytradingcoach.html` avant et reproduis son style) :
  - questions des 30 derniers jours, avec filtre par source ;
  - **questions sans bonne réponse** en premier (`ESCALATE` et 👎) : ce sont elles qui serviront à enrichir la base ;
  - tickets envoyés ;
  - coût Haiku du mois et appels du jour par rapport au plafond.
- **Tests** (Vitest, Anthropic simulé en CI) :
  - question couverte par la base : réponse `KB`, Anthropic non appelé ;
  - question hors base : appel Haiku, `max_tokens` ≤ 400, `AiUsageLog` écrit ;
  - question sur une prop firm : la valeur vient du catalogue, avec la source et la date ;
  - demande de conseil de trading : refus ;
  - tentative de détournement du rôle : refus ;
  - quota dépassé : 429 ; plafond global atteint : plus d'appel Haiku ;
  - ticket : e-mail envoyé à `support@` avec la transcription ;
  - aucun montant en dur dans `kb/` ;
  - côté Angular : ouverture, suggestion, passage à un humain.
  - Playwright : parcours complet sur la landing et dans l'app, à 390 et 1440 px.
- Mets à jour `nestjs.md`, `angular.md`, `astro.md`, `plans.md`, `prisma.md` et `security.md`. Enrichis le seed démo avec quelques questions d'exemple pour la page admin.
- **Arrêt** avant l'étape 5 : rapport, captures de la page admin.

## Étape 5 — Conversation à double sens (réponses depuis l'admin)
Le client doit voir mes réponses **dans le chat**, comme sur Intercom, et pouvoir répondre au même endroit. Je réponds depuis l'admin, pas depuis Zoho.

**Modèle de données** (remplace l'envoi ponctuel du ticket de l'étape 2, qui devient l'ouverture d'une conversation) :
- `SupportConversation` : `id`, `userId` facultatif, `email`, `status` (`OPEN | WAITING_USER | CLOSED`), `lastMessageAt`, `unreadForUser` (booléen), `unreadForAdmin` (booléen), `accessTokenHash` (pour les visiteurs sans compte), `createdAt`.
- `SupportMessage` : `id`, `conversationId`, `author` (`USER | ADMIN | BOT`), `body` (texte brut, 4 000 caractères au plus), `createdAt`.
- Migration, index sur `(userId, lastMessageAt)` et `(status, lastMessageAt)`. Comptes démo exclus partout (`isDemo: false`). Conversations conservées 12 mois, puis purgées par un cron. Mets à jour la politique de confidentialité.

**Côté client (chat de l'app et de la landing) :**
- « Parler à un humain » crée une conversation. Elle reprend la transcription de l'échange avec le bot, en messages `BOT` et `USER`, puis le message du client.
- Le panneau a un onglet **« Messages »** (comme chez Miltraders), avec la liste des conversations et leur statut. Le client y lit mes réponses et répond au même endroit.
- **Pastille non lu** sur le bouton d'aide quand j'ai répondu (`unreadForUser`). Vérification à l'ouverture de l'app et toutes les 60 s quand l'onglet est visible, sans WebSocket pour cette version.
- **Utilisateur connecté** : ses conversations sont liées à son compte et visibles sur tous ses appareils.
- **Visiteur sans compte** : la conversation est liée à un jeton aléatoire, stocké haché en base et gardé dans le navigateur. L'e-mail de réponse contient un **lien sécurisé** (jeton signé, valable 30 jours) qui rouvre la conversation sur le site, sur n'importe quel appareil. Si ce visiteur crée ensuite un compte avec le même e-mail, rattache ses conversations à son compte.
- Le client ne voit jamais l'adresse `hello@`. Les e-mails partent de l'identité « support ».

**Côté admin (page « Support ») :**
- Une boîte de réception : conversations triées par `lastMessageAt`, filtres « À traiter » (`unreadForAdmin` ou `OPEN`), « En attente du client », « Fermées ».
- Le fil complet de la conversation, avec le passage par le bot en gris. À côté, la fiche du client : e-mail, plan, date d'inscription, compte Tradovate connecté ou non, plan prop firm relié. Aucune donnée de trading.
- Un champ **« Répondre »** (Ctrl+Entrée pour envoyer), un bouton « Fermer la conversation » et un bouton « Rouvrir ».
- Quand je réponds :
  - le message apparaît dans le chat du client, avec la pastille non lu ;
  - le client reçoit un e-mail « Grégory t'a répondu » (Resend, identité support) avec ma réponse en entier et un bouton « Voir la conversation ». Une réponse par e-mail au maximum toutes les 10 minutes par conversation, pour ne pas spammer si j'envoie plusieurs messages d'affilée ;
  - le statut passe à `WAITING_USER`.
- Quand le client répond : le statut repasse à `OPEN`, et je reçois une notification. Utilise le système de notifications admin existant, plus un e-mail à `support@` résumant le message. Pas plus d'un e-mail toutes les 10 minutes par conversation.
- Compteur « À traiter » dans le menu de l'admin.
- Si un client écrit directement à `support@` par e-mail, rien ne change : ça arrive dans Zoho. **Aucune lecture des e-mails entrants** dans cette version.

**Sécurité :**
- Le client ne lit et n'écrit que dans ses propres conversations. Contrôle par `userId`, ou par jeton pour un visiteur. Tests de non-accès croisé.
- Les routes admin sont protégées par le guard admin existant.
- Throttle sur l'envoi de messages côté client : 20 par heure. Texte brut uniquement, échappé à l'affichage, liens rendus cliquables sans HTML.
- `@DemoAllowed()` non accordé ici : un compte démo ne peut pas ouvrir de conversation. Le bouton « Parler à un humain » lui propose de créer un compte.

**Tests :**
- ouverture d'une conversation, avec la transcription du bot ;
- réponse admin : message visible côté client, pastille, un seul e-mail même si deux réponses arrivent en moins de 10 minutes ;
- réponse du client : statut `OPEN`, notification admin ;
- visiteur : lien sécurisé valide, lien expiré refusé, rattachement à la création du compte ;
- accès croisé refusé ;
- Playwright : un échange complet client → admin → client, à 390 et 1440 px.

Mets à jour `nestjs.md`, `angular.md`, `prisma.md` et `security.md`. Captures du chat (onglet Messages, pastille) et de la boîte de réception admin.

- **Stop. Aucun push sans mon « OK push ».**

</details>


## Cadrage du relecteur (2026-11-28, tri du 26/11 : « 493 B étapes 1-2 derrière flag »)

Une seule PR vers `dev`, tout derrière `HELP_CHAT_ENABLED`, éteint par défaut : interrupteur éteint, les 4 routes `help` répondent 404, rien n'est écrit ni envoyé. Consignes périmées : branche depuis `beta`, « OK push », arrêts pour Greg (le relecteur valide, PR vers `dev`).

- **Étape 1, base de connaissances** (1er commit) : `apps/api-mytradingcoach/src/modules/help/kb/`, une trentaine de `.md` (front-matter `id`, `title`, `keywords` avec variantes, `audience: all | app`, `links`). Prix et durées en variables seulement (`{{PREMIUM_MONTHLY}}`, `{{PREMIUM_YEARLY}}`, `{{TRIAL_DAYS}}`, `{{FOUNDER_MONTHLY}}`, `{{FOUNDER_SEATS_LEFT}}`…), valeurs de `@mtc/shared` et de la base à l'exécution ; une spec échoue sur un montant ou une durée chiffrée dans `kb/`, une autre sur une variable sans valeur. Prop firms : aucune copie, lecture de `prop-firm-catalog.service` (fiche citée, source, `verified_at`, « seules les règles officielles de la firme font foi »), plans `needs_review` et non publics exclus. Route publique : entrées `audience: all` seulement. Fichiers présents dans l'image (assets du build ou TS généré), spec qui charge la base depuis le build. Conformité : aucun autre courtier que Tradovate et NinjaTrader, jamais « partenaire officiel », aucune promesse de gain, `support@` jamais `hello@`, tutoiement, 3 à 6 lignes. **Arrêt pour relecture : le relecteur relit** (liste titre + réponse rendue avec les vraies valeurs, et ce qui n'a pas pu être vérifié ; non vérifiable = pas écrit ; trou légal ou business → remonté à Greg, entrée hors base en attendant, sans bloquer la PR).
- **Étape 2, API** (2e commit) : `POST /api/help/ask` (`JwtAuthGuard`, `@DemoAllowed()`), `POST /api/public/help/ask`, `POST /api/help/ticket` (démo 403), `POST /api/public/help/ticket` (3 par heure et par IP). DTO : `message` 1-500, `history` ≤ 6 échanges de ≤ 500, `page` facultatif ; contrats dans `@mtc/shared`. Ordre : recherche locale normalisée avec seuil (constante exportée, surcharge par env) → `AI_MODELS.fast`, `max_tokens` 400, `AI_THINKING_OFF`, `cache_control: ephemeral` sur le prompt système, 5 entrées les plus proches, fiche de la firme citée → passage à un humain. Historique du navigateur non fiable : cité dans le tour utilisateur, jamais en rôle `assistant` ; garde-fou de sortie : montant absent du contexte → passage à un humain. Quotas Redis (TTL 48 h) : connecté `help:calls:{userId}:{jour}` 30/j ; visiteur 10/j par IP hachée (HMAC, clé dérivée d'un secret existant comme `oauth-state.util.ts`, IP brute jamais stockée) + 10/min ; 429. Plafond global `HELP_CHAT_DAILY_LLM_MAX` (défaut 500), INCR atomique avant l'appel ; au-delà base locale puis humain ; alerte unique par jour à 80 % (`AdminPushService`). `AiUsageLog` `feature: 'help_chat'` (`userId` null pour un visiteur). `HelpQuestion` : migration additive, aucune IP ni donnée de trading, purge à 90 jours par cron, `isDemo: false` dans les stats. Ticket : e-mail à `support@` (transcription, page, plan), accusé de réception par l'identité support, `RESEND_DRY_RUN` hors prod. Démo : `ask` permis avec le quota visiteur (compte partagé), Haiku sous le plafond global.
- **IA hors prod** : `AI_ENABLED === 'true'` (jamais `NODE_ENV`) ; IA éteinte : base locale normale, repli = réponse simulée marquée, sans appel, sans `AiUsageLog`, sans toucher au plafond. Anthropic simulé en CI.
- **Hors PR** : étape 3 (widgets app et landing, politique de confidentialité, questions fréquentes, 👍/👎), étape 4 (admin « Support », seed, Playwright), étape 5 (conversation à double sens) : un ticket de suite par étape dans Idées.
- **plans.md** : exception IA gratuite écrite par Greg dans le ticket du 22/10 → `plans.md`, `reference/plans/cout-ia.md` (borné par quota, plafond global ≈ 0,25 $/j), entrée `decisions.md` du 2026-11-28.
- Vérificateurs : nestjs, security, tests (API) ; prisma, security (`HelpQuestion`) ; nestjs, angular, tests (`libs/shared`) ; plans ; relecteur (contenu de la base).
- Pour Greg : rien avant la PR ; allumage de `HELP_CHAT_ENABLED` (dev puis prod) après l'étape 3 et la validation du texte de confidentialité.
