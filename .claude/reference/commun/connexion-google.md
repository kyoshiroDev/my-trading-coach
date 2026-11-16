# Connexion Google (#618)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md`, `.claude/agents/prisma.md`, `.claude/agents/security.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Connexion Google (#618, 2026-10-18) · 2026-10-18 -->
> **Origine** : `nestjs.md` · « Connexion Google (#618, 2026-10-18) » · 2026-10-18

## Connexion Google (#618, 2026-10-18)

Routes (`modules/auth`) : `GET /auth/google/config` (public), `POST /auth/google` (public,
`GoogleAuthDto` : `credential` + `referralCode` + UTM normalisés comme `RegisterDto`, **pas**
d'opt-in marketing), `POST /auth/google/finalize` (`GoogleFinalizeDto { marketingConsent }`,
idempotent : une 2de finalisation ne réécrit pas le consentement), `DELETE /auth/google`.
- `POST /auth/google` renvoie comme login/register (`access_token`, cookie de refresh, `user`) +
  `googleStatus` (`login | linked | created`) + `passwordCleared`.
- Création **commune** e-mail / Google : `AuthService.createAccount` (parrain, UTM, setups par
  défaut, e-mail de bienvenue, push admin). Toute nouvelle conséquence d'une inscription va là.
- Double clic Google : P2002 à la création → nouvel essai unique qui tombe sur la connexion.
- Utilisateur renvoyé au front : `toMe(row)` sur `ME_ROW_SELECT` ajoute `hasPassword`,
  `googleLinked`, `needsSignupFinalization` et retire `password` / `googleId`. Ne jamais
  renvoyer `ME_ROW_SELECT` brut.
- Tests : `auth.service.spec.ts` (règles), `google-id-token.verifier.spec.ts` (vraie vérif),
  `google-auth.int-spec.ts` (bout en bout, vérificateur remplacé ; app montée avec `cookieParser` et
  `ValidationPipe` comme `main.ts`, sinon `/auth/refresh` plante et les UTM ne sont pas normalisés).

<!-- Origine : angular.md · Connexion Google (#618, 2026-10-18) · 2026-10-18 -->
> **Origine** : `angular.md` · « Connexion Google (#618, 2026-10-18) » · 2026-10-18

## Connexion Google (#618, 2026-10-18)

- `GoogleIdentityService` (`core/auth`) : config lue sur `GET /auth/google/config` (rien en dur dans
  `environment.*.ts`), script GIS `accounts.google.com/gsi/client` injecté **à la demande** et
  seulement si actif. Aucune dépendance npm Google côté front.
- `mtc-google-auth-button` (`shared/components`) : bouton **officiel** rendu par Google (jamais
  redessiné) : `outline`, `large`, `rectangular`, `continue_with`, logo à gauche, largeur = largeur
  mesurée de l'hôte (max 400), redessiné au redimensionnement (`ResizeObserver`, 150 ms) ; zone de
  44 px sans fond. Bouton personnalisé « Continuer en tant que… » : affiché par Google dès qu'une
  session a accepté le site, **aucune option ne le désactive** en `large` ≥ 200 px (doc GIS) ; il
  reçoit les mêmes réglages. Séparateur « ou ». Rien si inactif ou script
  bloqué. Navigateur intégré (`isInAppBrowser` de `@mtc/shared`) : invitation à ouvrir le
  navigateur + « Copier le lien », pas de bouton. Zone toujours présente (classe `.gone`) : le
  script y dessine, un `viewChild` dans un `@if` n'était pas résolu à temps. Bouton Google = iframe
  de 40 px (non modifiable) centrée dans une zone de 44 px.
- `mtc-signup-terms-note` (`features/auth/auth-layout`, #745 F2) : « tu acceptes les CGU et confirmes
  avoir 18 ans » **avant chaque bouton qui crée un compte** (variantes `email`, `google`,
  `google-login` : sur la connexion, Google crée le compte au 1er passage). L'API enregistre date et
  version (`CGU_VERSION`) à la création : nouveau bouton de création = la mention avec, sinon
  l'enregistrement ment. Verrouillé par `signup-terms-note.spec.ts`.
- `GoogleSignInService` : parrain (`mtc_ref`) et UTM (`mtc_utm`) lus dans le stockage
  (`signup-context.ts`) ; compte créé → `/inscription/finaliser` (`GoogleFinalizeComponent`, opt-in
  non coché, `plan=premium` repassé) ; compte relié → toast au 1er passage (mention du mot de passe
  retiré) ; sinon `PostSignupService.afterLogin`. Erreurs : `googleAuthErrorMessage` (par `code`).
- `PostSignupService` : navigation après inscription / connexion **commune** e-mail et Google (offre
  du lien, paiement Premium, tableau de bord). Toute nouvelle suite d'inscription va là.
- **Bundle initial** : `/register` importe le bouton (+8,5 kB bruts, +3,1 kB gz : 476,7 → 485,2 kB,
  budget bloquant 500). `GoogleSignInService` y est importé à la demande (`import()` au clic). Pas
  de `@defer` : son moteur coûtait plus que le gain.
- Intercepteur `front-auth` : seul `POST …/auth/google` exact est une route d'auth (sans jeton) ;
  `/auth/google/finalize` et `DELETE /auth/google` gardent le jeton.
- Profil : « Définir » (mot de passe absent, même e-mail que « Modifier ») ; ligne « Connexion
  Google » avec « Délier » désactivé tant qu'aucun mot de passe n'existe.

<!-- Origine : prisma.md · Connexion Google (#618, 2026-10-18) · 2026-10-18 -->
> **Origine** : `prisma.md` · « Connexion Google (#618, 2026-10-18) » · 2026-10-18

## Connexion Google (#618, 2026-10-18)

Migration `20261018140000_google_auth`, additive et compatible N-1 :
- `User.password` **nullable** : null = compte créé avec Google sans mot de passe. Tout code qui lit
  le hash doit traiter null (`login` → 401 identique, jamais `argon2.verify(null)`).
- `googleId String? @unique` (`sub` Google, jamais renvoyé au front), `authProvider AuthProvider
  @default(EMAIL)` (enum `EMAIL | GOOGLE`, copié dans `@mtc/shared` `CONTRACT_ENUMS`),
  `emailVerifiedAt` (posé par Google et par un reset de mot de passe réussi), `signupFinalizedAt`
  (écran de finalisation Google validé), `tokenVersion Int @default(0)` (révocation des refresh
  tokens). Comptes existants : `EMAIL`, non vérifiés, version 0, aucun backfill.
- Recherche d'un compte par e-mail pour Google : `mode: 'insensitive'` (les e-mails ne sont pas
  normalisés en minuscules à l'inscription classique).

`User.termsAcceptedAt` / `User.termsVersion` (migration `20261030120000_terms_acceptance`, #745 F2,
additive, nullable, compatible N-1) : posés par `AuthService.createAccount` (e-mail ET Google) à la
création du compte, version = `CGU_VERSION` de `@mtc/shared`. Pas de rattrapage : null = compte créé
avant l'enregistrement (acceptation jamais tracée), ne pas le remplir après coup.

`User.marketingConsentWithdrawnAt` (migration `20261030140000_marketing_consent_withdrawn`, #747,
additive, nullable, compatible N-1) : date du RETRAIT du consentement marketing (lien de
désinscription ou réglage du profil coupé). `marketingConsentAt` n'est plus jamais remis à null au
retrait : c'est la preuve du consentement donné. Nouveau consentement → `marketingConsentAt` = maintenant,
`marketingConsentWithdrawnAt` = null. Les comptes désinscrits avant le 30/10 ont les deux à null.

`User.stripeCancelAt` (migration `20261101120000_user_stripe_cancel_at`, #813, additive, nullable, sans
défaut, compatible N-1) : fin programmée de l'abonnement, écrite par `syncSubscription` (`cancel_at`,
ou fin de période si `cancel_at_period_end`), remise à null avec les autres champs Stripe à la fin de
l'abonnement. Pas de rattrapage : renseignée au prochain `customer.subscription.updated`.

`User.isInternal` et `DeletedAccount.isInternal` (migration `20261101150000_is_internal`, #823,
`BOOLEAN NOT NULL DEFAULT false`, sans réécriture de table, sans index, compatible N-1) : compte
interne (tests de l'équipe), exclu des statistiques admin par `REAL_USERS_WHERE`. Posé depuis la fiche
admin, jamais par SQL ni par le domaine de l'adresse ; recopié dans `DeletedAccount` à la suppression.
La règle des 90 jours lit toutes les lignes `DeletedAccount`, internes comprises.

`TradingAccount.statusChangedAt` (migration `20261102120000_account_status_changed_at`, #684, additive,
nullable, sans réécriture de table, compatible N-1) : date du dernier changement de `status`. `null`
pour tout compte antérieur, lu comme « ancien » par la pause de synchro (règle dans `nestjs.md`,
« Pause de la synchro des comptes perdus »). Aucun index : lu par relation depuis `BrokerConnection`.

`TradovateAccountObservation` + enum `TradovateObservationOutcome` (migration
`20261103090000_tradovate_account_observation`, #684 phase 2, nouvelle table seulement, compatible N-1) :
journal d'observation, une ligne par connexion et par jour (`@@unique([connectionId, day])`, `day` en
`@db.Date` Paris, index sur `day` pour la purge à 90 j). `onDelete: Cascade` depuis `BrokerConnection`.
Aucun jeton, montant ni identifiant Tradovate. Règles dans `nestjs.md`, « Journal d'observation Tradovate ».

`EcoEvent` : clé unique `(date, name, currency, country)` (migration `20261116090000_eco_event_country_key`,
C6 #1046). Avant, `(date, name, currency)` fusionnait les PMI flash France / Allemagne / zone euro (même
libellé, EUR). Sans perte (lignes existantes déjà uniques), historique fusionné gardé. Upsert par
`date_name_currency_country` (service et seed démo). Pas compatible N-1 : pendant la bascule, l'ancienne
version ne trouve plus l'unique à 3 colonnes et son upsert échoue ; le relevé suivant (20 s) repasse. Les
épingles restent des clés `nom:devise` (une épingle couvre les annonces de ce nom dans cette devise).

<!-- Origine : security.md · Connexion Google (#618, 2026-10-18) · 2026-10-18 -->
> **Origine** : `security.md` · « Connexion Google (#618, 2026-10-18) » · 2026-10-18

## Connexion Google (#618, 2026-10-18)

- **Vérification** : `GoogleIdTokenVerifier` (`modules/auth/google-id-token.verifier.ts`,
  `google-auth-library` épinglée) : signature, `aud` = `GOOGLE_CLIENT_ID` de l'environnement,
  `iss`, expiration, puis `email_verified === true`. Message de la lib jamais relayé. Spec avec
  une vraie clé RSA de test (seuls les certificats Google sont remplacés).
- **Flag** : `resolveGoogleAuthConfig` (`config/google-auth-config.ts`) : actif seulement si
  `FEATURE_GOOGLE_AUTH=true` ET `GOOGLE_CLIENT_ID` défini, sinon `POST /auth/google` → 404.
  `GET /auth/google/config` (`@Public`, cache 5 min) donne `{ enabled, clientId }` au front : rien
  en dur dans les `environment.*.ts`.
- **Liaison sur un compte jamais vérifié** (aucune vérification d'e-mail à l'inscription classique) :
  mot de passe supprimé + `tokenVersion` incrémenté (`passwordCleared: true` dans la réponse). Sans
  ça, un tiers ayant pré-créé un compte sur l'adresse garderait son mot de passe et sa session.
- **Refresh token** : porte `tv` (version) ; `refresh` refuse une version ≠ `User.tokenVersion`
  (jeton sans `tv` = version 0). Incrémenter `tokenVersion` = déconnecter toutes les sessions.
  Incrémenté aussi à la réinitialisation du mot de passe (#994). Chaque refresh porte un `jti` et
  une famille `fid` (une par connexion, gardée à chaque refresh, #1002), suivie dans le hash Redis
  `auth:refresh-family:<fid>` (script Lua de `auth/refresh-rotation.ts`, TTL 7 j) : un `jti` déjà
  renouvelé et rejoué plus de 60 s après (`REFRESH_REUSE_GRACE_MS`) = copie du cookie → famille
  entière coupée (log « Refresh déjà renouvelé puis rejoué »). Les 60 s couvrent les onglets qui
  renouvellent en même temps (cookie partagé) et la réponse perdue rejouée. `POST /auth/logout`
  coupe la famille du refresh présenté ; les autres appareils restent connectés. Jeton sans `fid`
  (d'avant #1002) : famille `j:<jti>` ; liste noire `auth:revoked-refresh:<jti>` des anciennes
  déconnexions encore lue (à retirer 7 j après la mise en prod de #1002). Redis en panne : refresh accepté (fail-open voulu).
  Connexion : e-mail inconnu ou compte sans mot de passe → argon2 vérifie un hash factice
  (`dummyPasswordHash`), même coût qu'un mauvais mot de passe (anti-énumération par le temps).
- **Retour après connexion** (front, `core/auth/return-url.ts`, #994) : liste blanche — chemin
  interne seulement (`/…`), jamais `//hote`, `\`, URL absolue ni page d'auth (login, register,
  forgot / reset-password) : pas de redirection ouverte. Stocké en `sessionStorage`.
- **Mot de passe oublié** : l'API répond 204 pour toute adresse ; le front n'affiche le succès que
  sur 204 et un message sur 429 / 400 / panne (#994) — aucune réponse ne révèle un compte.
- **Exclus** : comptes `isDemo` et `ADMIN` (403 `GOOGLE_NOT_ALLOWED`), en connexion comme en liaison.
  Une liaison existante n'est jamais remplacée par un autre `sub` (409 `GOOGLE_ALREADY_LINKED`).
- **Délier** (`DELETE /auth/google`) refusé sans mot de passe (400 `PASSWORD_REQUIRED`).
- **Mot de passe oublié** d'un compte sans mot de passe : même 204, e-mail « Connexion à ton
  compte » qui rappelle Google et sert à définir un mot de passe (`googleOnly`).
- **Rate limit** `POST /auth/google` : 10/min (`default`, par IP faute d'e-mail dans le corps) +
  30/10 min (`ip`). **Logs** : issue (`created | linked | login`, raison d'un refus) + id interne
  seulement, jamais le jeton, l'e-mail ni le `sub`.
