# PROMPT — Tirage au sort mensuel (gratuits + Premium), onglet « Concours du mois », pilotage dans l'admin

> **Contexte (20/11).** Greg veut récompenser les utilisateurs actifs chaque mois, pour leur donner une raison de revenir dans l'app et pour que les nouveaux inscrits voient que « des gens gagnent vraiment ». Deux tirages, le 1er de chaque mois :
> - **Comptes gratuits actifs** : 1 mois de Premium offert, sans carte, retour au gratuit à la fin.
> - **Abonnés Premium payants depuis au moins 2 mois** : 3 mois offerts (le prochain prélèvement est repoussé, puis l'abonnement reprend normalement).
>
> **Tout est éteint par défaut.** Rien ne se passe (pas de tirage, pas d'onglet, pas de section sur la landing, pas d'e-mail) tant que Greg n'a pas allumé un interrupteur dans l'admin. Il y a deux interrupteurs indépendants : un par tirage.
>
> Le but : zéro charge mentale pour Greg. Il ne lui reste que les interrupteurs, la validation des messages des gagnants et le bouton « Publier » sur Instagram.
>
> Branche `feat/tirage-mensuel` depuis `origin/dev` à jour, dans un worktree séparé. Circuit habituel : vérificateurs des domaines touchés, **relecteur en dernier**, « OK à 100 % » → push + PR vers `dev`. Greg merge. Le chantier est découpé en **3 lots = 3 PR** (A, B, C), dans cet ordre ; chaque lot passe le circuit complet avant le suivant.

## Règles de travail
- Enregistre ce prompt dans `.claude/prompts/PROMPT-tirage-mensuel.md`.
- Domaines touchés : prisma, nestjs, security, plans, angular, design, astro, tests, et `contexte-com.md` pour tous les textes. Lis la maquette `admin-mytradingcoach.html` avant l'admin.
- Durées des lots, seuil d'activité, ancienneté Premium, jour et heure du tirage : **constantes dans `@mtc/shared`**, jamais en dur.
- Comptes démo, internes (`isInternal`), admin et supprimés : **jamais éligibles**, jamais destinataires d'un e-mail.
- Textes : tutoiement, honnêtes, **aucune promesse de gain de trading**, aucun prix affiché dans l'app hors `@mtc/shared`. Jamais de faux gagnant ni de faux message.
- Rien sur la prod, les VPS ni Stripe live. Les nouvelles variables d'environnement sont documentées dans `.env.example` ; Greg les remplit lui-même. Ne lis jamais le `.env`.

## Étape 0 — Audit (arrêt, validé par le relecteur)
Rapport court :
1. **Onglet « Score trader »** (`features/scoring`, entrée `nav-scoring` de la sidebar) : ce qu'il affiche, ce qui en dépend (API, débrief, e-mails, tests), et s'il peut être masqué de la navigation sans rien casser.
2. **Premium offert existant** : comment l'admin offre du Premium (`trialSource = ADMIN`, `trialEndsAt`), comment le cron de fin d'essai remet en gratuit et envoie ses e-mails, et ce qui se passe si un essai est déjà en cours.
3. **Report de facturation Stripe** : comment le « 1 mois offert » du parrainage (`ReferralReward`, `stripe-referral.service`) est appliqué à un abonné payant (crédit, coupon, `trial_end`…), mensuel et annuel. Peut-on le réutiliser pour N mois ?
4. **Définition de « actif »** : ce que contiennent `Trade` (date, source) et `UserDailyActivity`, et la règle proposée.
5. **E-mails** : service d'envoi, gabarits, gestion du désabonnement marketing, adresse de notification admin déjà utilisée (récap des inscriptions).
6. **Crons** : le modèle existant (verrou, idempotence, fuseau Europe/Paris).
7. **Landing** : comment une section peut s'afficher selon une donnée de l'API (la landing est statique, servie par nginx).
8. **Metricool** : ce que demande l'API (abonnement requis, jeton, `userId`, `blogId`, image en URL publique).

Le relecteur valide le plan et tranche les détails. Il ne remonte à Greg que ce qui lui revient.

## Lot A — Données, tirage automatique, attribution des lots, admin (PR 1)

### Modèle (Prisma, migration)
- `GiveawaySettings` (une ligne) : `freeEnabled`, `premiumEnabled` (faux par défaut), dates d'activation.
- `GiveawayDraw` : `period` (« 2027-01 »), `pool` (`FREE` | `PREMIUM`), nombre d'éligibles, `drawnAt`, gagnant (ou aucun), et une trace d'audit (liste ordonnée des identifiants éligibles hachée + valeur tirée). **Unique sur (`period`, `pool`)** : un tirage ne peut jamais être fait deux fois.
- `GiveawayWin` : utilisateur, lot (en mois), début, fin, statut d'activation, consentement d'affichage (`NONE` | `PSEUDO` | `PRENOM_INITIALE`), message (≤ 140 caractères) et son statut de modération (`EN_ATTENTE` | `VALIDE` | `REFUSE`), consentement Instagram (oui/non + pseudo Instagram facultatif), statut de publication.
- `TrialSource` : ajoute `GIVEAWAY`.
- Mets à jour `prisma.md`.

### Éligibilité (constantes dans `@mtc/shared`)
- **Gratuits** : aucun abonnement Stripe actif ; compte de plus de 7 jours ; e-mail vérifié ; **au moins 5 trades** dans le mois écoulé (date du trade, fuseau Europe/Paris, toutes sources) ; pas gagnant d'un tirage dans les 6 derniers mois.
- **Premium** : `stripeSubscriptionStatus = active` (ni `trialing`, ni `past_due`), **au moins 2 factures payées**, aucune résiliation programmée (`stripeCancelAt` vide), pas gagnant dans les 6 derniers mois. Le seuil d'activité de 5 trades s'applique aussi.
- Démo, internes, admins, supprimés : exclus partout.

### Tirage automatique
- Cron le **1er du mois à 9h (Europe/Paris)**, sur le modèle des crons existants, avec verrou. Il tourne seulement pour les tirages allumés.
- Tirage avec `crypto.randomInt` sur la liste des éligibles triée par identifiant. Trace d'audit enregistrée.
- Aucun éligible : pas de gagnant, tirage enregistré quand même avec 0, et e-mail à Greg.
- **Attribution automatique du lot** :
  - **Gagnant gratuit** : Premium offert par le même mécanisme que l'admin, `trialSource = GIVEAWAY`, 1 mois à partir de `max(maintenant, trialEndsAt)`. À la fin, le cron de fin d'essai existant le remet en gratuit. Trois jours avant la fin, il reçoit un e-mail qui lui propose de garder le Premium, avec le même gabarit que la fin d'essai, adapté.
  - **Gagnant Premium** : son prochain prélèvement Stripe est repoussé de 3 mois, par le mécanisme repéré à l'étape 0. Pas de prorata, et l'abonnement reprend normalement ensuite. Mensuel et annuel sont tous les deux gérés. Testé en mode test Stripe uniquement.
- **E-mails** (expéditeur contact@) :
  - au gagnant : ce qu'il a gagné, la date de fin, et un lien vers sa page gagnant dans l'app ;
  - à Greg : le gagnant de chaque tirage (pseudo, e-mail, lot, nombre d'éligibles), et un lien vers l'admin.
- Respecte les quatre points de `plans.md` (landing, front, guard, cron) et mets ce fichier à jour.

### Admin : onglet « Tirages » (selon `admin-mytradingcoach.html`)
- **Deux interrupteurs**, « Tirage gratuits » et « Tirage Premium ». Chacun affiche le nombre d'éligibles s'il y avait un tirage maintenant, et la date du prochain tirage.
- **Allumer un interrupteur** ouvre une confirmation : « X utilisateurs recevront un e-mail d'annonce ». Après validation, l'e-mail d'annonce part une seule fois par activation :
  - aux gratuits pour le tirage gratuit, aux Premium pour le tirage Premium ;
  - en respectant le désabonnement marketing ;
  - jamais aux comptes démo ou internes.
- **Éteindre un interrupteur** n'envoie rien. Les lots déjà gagnés restent acquis.
- **Historique** : mois, tirage, gagnant, lot, début, fin, nombre d'éligibles, consentements, message et statut de publication.
- **Modération** : boutons « Valider » et « Refuser » sur le message du gagnant. Rien ne s'affiche dans l'app tant que ce n'est pas validé.
- **« Tirer maintenant »** n'existe que hors production (environnement dev, pour les tests), protégé par la configuration.
- Toutes ces routes sont réservées au rôle ADMIN. Les métriques excluent `isDemo` et `isInternal`.

### Tests
- Tests unitaires :
  - éligibilité, chaque critère et chaque exclusion ;
  - idempotence : deux lancements du cron donnent un seul tirage ;
  - aucun éligible ;
  - attribution gratuite, y compris pendant un essai en cours ;
  - fin du lot et retour au gratuit ;
  - interrupteurs éteints : rien ne se passe.
- Test d'intégration du report Stripe en mode test.
- e2e admin : allumer, voir l'historique, modérer.

## Lot B — Onglet « Concours du mois » dans l'app, page gagnant, landing, règlement (PR 2)

### App
- **Dès qu'au moins un tirage est allumé**, l'entrée « Score trader » de la sidebar devient « Concours du mois », avec la même place et une icône cadeau. Quand tout est éteint, la navigation reste comme aujourd'hui.
- La page « Score trader » n'est pas supprimée : elle reste accessible par son URL. Ce qu'on en fait ensuite, c'est Greg qui le décidera.
- **Page « Concours du mois »**, visuelle et percutante, dans le style « The Terminal » (tokens de `theme.css`) :
  - **en-tête** : les lots du mois (« 1 mois de Premium » pour les gratuits, « 3 mois offerts » pour les Premium), et un compte à rebours jusqu'au prochain tirage ;
  - **mon statut** : « Tu es dans le tirage » ou « Encore 2 trades pour participer ce mois-ci », avec une barre de progression vers les 5 trades. C'est ce qui fait revenir dans l'app ;
  - **compteurs réels** : nombre de gagnants depuis le début, gratuits et Premium, et nombre de mois de Premium offerts. **S'il n'y a encore aucun gagnant**, affiche « Premier tirage le 1er … » à la place de « 0 » ;
  - **liste des gagnants** : mois, tirage, nom affiché selon le consentement (pseudo ou prénom avec initiale, sinon « Un trader »), lot, et le message du gagnant s'il a été validé ;
  - **conditions** : un résumé en 4 lignes, avec un lien vers le règlement ;
  - pour un utilisateur qui n'est éligible à aucun tirage allumé, une phrase honnête, par exemple pour un Premium depuis moins de 2 mois : « Tu participeras au tirage Premium dès ton 2e mois d'abonnement. »
- **Page gagnant** (lien de l'e-mail) : son lot déjà activé et sa date de fin, le choix de l'affichage (aucun, pseudo, prénom avec initiale), un message facultatif de 140 caractères au plus, et l'accord pour une publication Instagram (case séparée, non cochée par défaut, avec son pseudo Instagram facultatif). Tout reste modifiable ensuite.
- Responsive 390 et 1440 px, `data-testid` sur chaque élément testé.
- **Compte démo** : l'onglet est visible et montre la page avec des données de démonstration clairement marquées « exemple », **sans aucun faux message de gagnant**. Enrichis le seed démo.

### Landing (`/prop-firm`)
- Une section « Chaque mois, des traders gagnent du Premium » **n'apparaît que si au moins un tirage est allumé**. Elle lit un endpoint public de l'API, en lecture seule, mis en cache, qui ne donne que les données affichables (lots, prochain tirage, compteurs, noms autorisés). Aucune donnée personnelle sans consentement.
- La section donne les lots, la condition principale (« Inscris-toi et enregistre tes trades »), les compteurs réels et un bouton d'inscription. Aucune promesse de gain de trading.

### Règlement
- Une page `/reglement-tirage` sur la landing (noindex), avec un lien depuis l'app et depuis la section de la landing. Elle précise :
  - l'organisateur, et que le tirage est gratuit, sans obligation d'achat, pour le tirage des comptes gratuits ;
  - qu'il est réservé aux majeurs ;
  - les conditions d'éligibilité exactes, tirées des constantes ;
  - le mode de tirage (aléatoire, automatique, trace d'audit conservée) ;
  - les lots et leur durée ;
  - l'utilisation du nom et du message, seulement avec accord ;
  - le droit de modifier ou d'arrêter le tirage ;
  - le contact.
- **Texte légal = décision de Greg** : le relecteur prépare la version complète et prête à valider, et la met dans « Pour Greg ».

### Tests
- Tests unitaires de la page (statut, progression, compteurs à 0, liste avec consentements) et de la page gagnant.
- e2e : onglet absent quand tout est éteint, présent quand un tirage est allumé ; section de la landing selon l'état.
- Captures 390 et 1440 px : page « Concours du mois », page gagnant, section de la landing, onglet admin.

## Lot C — Bouton « Publier sur Instagram » (PR 3)
- Dans l'admin, sur une ligne de l'historique, le bouton **« Publier » n'apparaît que si le gagnant a donné son accord Instagram** et que son message, s'il en a écrit un, est validé.
- Au clic :
  1. l'API rédige la légende avec la clé Anthropic de l'app (règles IA de `nestjs.md` : prompt caching, coût enregistré, erreurs gérées), en suivant `contexte-com.md` : tutoiement, aucune promesse de gain, aucun prix, uniquement les vraies données du gagnant, hashtags sobres ;
  2. l'API génère l'image depuis un gabarit fixe aux couleurs de l'app (1080×1350, le lot, le nom affiché selon le consentement, le mois, le logo), servie à une URL publique temporaire ;
  3. l'admin montre un **aperçu** (image et légende **modifiable**) ;
  4. « Confirmer la publication » envoie à l'API Metricool (marque Instagram, publication immédiate ou à l'heure choisie). Le statut de publication est enregistré et le lien est affiché.
- Variables `METRICOOL_API_TOKEN`, `METRICOOL_USER_ID`, `METRICOOL_BLOG_ID` dans `.env.example`, jamais en dur. **Si elles sont absentes**, ou si l'API Metricool refuse (abonnement), le bouton propose à la place « Télécharger l'image » et « Copier la légende ». Rien ne casse.
- Tests :
  - légende : un faux client Anthropic, et une vérification des interdits ;
  - image générée ;
  - appel Metricool avec un faux client ;
  - bouton absent sans consentement ;
  - repli sans configuration.
- **Aucun vrai post publié pendant le développement.**

## Fin de chaque lot
- Mets à jour les fichiers de référence concernés (`nestjs`, `angular`, `astro`, `plans`, `prisma`, `security`) et `decisions.md` (« 2026-11-20 : tirage mensuel gratuits + Premium, éteint par défaut, piloté dans l'admin »).
- Lint, typecheck, tests unitaires, d'intégration et e2e de l'API, de l'app, de l'admin et de la landing au vert.
- Vérificateurs des domaines touchés, relecteur en dernier, « OK à 100 % » → push + PR vers `dev`, CI suivie jusqu'au vert.
- Envoie-moi seulement la section « Pour Greg » du relecteur, 5 lignes de résumé et le lien de la PR. Je merge.

## Pour Greg, après les 3 merges et la mise en prod (rien de tout ça n'est fait par la session)
1. Valider le texte du règlement.
2. Remplir les variables Metricool sur le VPS prod si l'abonnement le permet.
3. Allumer le tirage voulu dans l'admin quand le moment est venu. Le premier tirage aura lieu le 1er du mois suivant.
