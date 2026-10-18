# Audit — Inscription et connexion avec Google (#619)

> Étape 0 du chantier #618. État du code au commit `4821f36d` (beta, 2026-10-18).
> Toutes les références sont relatives à la racine du dépôt.

---

## 1. Flux d'authentification actuel

### API (`apps/api-mytradingcoach/src/modules/auth/`)

| Route | Fichier:ligne | Comportement |
|---|---|---|
| `POST /auth/register` | `auth.controller.ts:45` → `auth.service.ts:89` | `@Public`, throttle 5/min (IP + e-mail) **et** 10/h (IP seule). Refus 409 si l'e-mail existe, hash argon2id (`password-hashing.ts`), création `User`, setups par défaut (`:146`), tokens, e-mail de bienvenue en tâche de fond (`:158`), push admin hors ADMIN (`:165`). |
| `POST /auth/login` | `auth.controller.ts:57` → `auth.service.ts:170` | throttle 10/min + 30/10 min IP. `argon2.verify(user.password, …)` (`:176`), rehash si anciens paramètres (`:181`), `lastLoginAt`. 401 « Identifiants invalides » dans tous les cas d'échec. |
| `POST /auth/refresh` | `auth.controller.ts:68` → `auth.service.ts:192` | Lit le cookie httpOnly `refresh_token`, vérifie avec `JWT_REFRESH_SECRET`, relit l'utilisateur (`ME_SELECT`), réémet les deux tokens. **Aucune révocation** : JWT sans état, pas de version de token en base. |
| `POST /auth/logout` | `auth.controller.ts:89` | Efface le cookie. Le refresh token reste valide jusqu'à expiration (7 j). |
| `POST /auth/forgot-password` | `auth.controller.ts:97` → `auth.service.ts:221` | 204 dans tous les cas (anti-énumération). Jeton aléatoire, stocké en SHA-256, TTL 1 h, e-mail Resend. |
| `POST /auth/reset-password` | `auth.controller.ts:106` → `auth.service.ts:251` | Vérifie le jeton haché + expiration, remplace le mot de passe. |
| `GET /auth/me` | `auth.controller.ts:112` | Renvoie `ME_SELECT` (`auth.service.ts:47`). |
| `POST /auth/demo-login` | `auth.controller.ts:83` | Compte `isDemo`, token 12 h sans refresh. |

- Tokens : `generateTokens` (`auth.service.ts:300`) → access 15 min, refresh 7 j (payload `{ sub, email }`).
- Cookie : `setRefreshCookie` (`auth.controller.ts:25`), `sameSite: 'none'` + `secure` en prod (`:30`).
- `JwtStrategy.validate` (`jwt.strategy.ts:26`) : utilisateur lu via `AuthUserCacheService` (Redis 60 s, invalidation obligatoire après écriture d'un champ du JWT, cf. `security.md`).
- **Vérification d'e-mail : n'existe pas.** Aucun champ, aucun e-mail de confirmation : une inscription e-mail/mot de passe est active immédiatement, sur une adresse jamais prouvée.
- **Normalisation de l'e-mail : aucune.** `RegisterDto.email` (`dto/register.dto.ts`) n'a pas de `@Transform` en minuscules ; les recherches sont `findUnique({ where: { email } })`, sensibles à la casse. Google renvoie l'adresse en minuscules : une liaison par e-mail ratera un compte créé avec `Prenom@Gmail.com`.
- Suppression de compte : `DELETE /users/me` (`users.controller.ts:81`) → `deleteMe` (`users.service.ts:518`) → `archiveAndDelete` (`:201`) : **suppression physique** du `User` + ligne d'archive `DeletedAccount` (`:226`, e-mail en clair, nom, plan, parrain, raison). Rien n'empêche de se réinscrire ensuite avec le même e-mail.
- En-têtes : helmet API verrouillé (`main.ts:52`), CORS `CORS_ORIGINS` (`main.ts:85`). Côté app, Traefik `infra/prod/traefik/conf.d/security.yml` : **pas de CSP, pas de COOP**, `Referrer-Policy: strict-origin-when-cross-origin`, `frameDeny`. Compatible avec Google Identity Services (GIS) sans modification.

### Front (`apps/app-mytradingcoach/src/app/`)

| Élément | Fichier:ligne |
|---|---|
| Routes `/login`, `/register`, `/forgot-password` | `app.routes.ts:26`, `:39`, `:51` (`/register` chargé directement, pas paresseux) |
| `AuthService.register` / `login` | `core/auth/auth.service.ts:105`, `:122` (→ `handleAuthResponse`, token en localStorage) |
| Inscription | `features/auth/register.component.ts:188` (`onRegister`) |
| Connexion | `features/auth/login.component.ts:55` (`onLogin`), messages d'erreur `:73` |
| Profil > Mot de passe « Modifier » | `features/profile/profile.component.ts:432` : **envoie l'e-mail de réinitialisation** (pas de changement de mot de passe direct) |
| Onboarding | Pas de redirection dédiée : toute auth réussie va sur `/dashboard`, la sidebar ouvre l'onboarding si `onboardingCompleted === false` (`shared/components/sidebar/sidebar.component.ts:150`) |

---

## 2. Modèle `User` (`prisma/schema.prisma:9`)

| Champ | Ligne | Constat |
|---|---|---|
| `password String` | `:12` | **Non nullable** → à rendre nullable (migration additive). `argon2.verify(null, …)` lèverait une exception : `login` doit traiter le cas « pas de mot de passe » comme un 401 identique. |
| `resetPasswordToken` / `Expires` | `:20` | Réutilisable pour « définir un mot de passe ». |
| e-mail vérifié | — | **Absent.** |
| `role Role` | `:14` | `ADMIN · USER · BETA_TESTER · AMBASSADOR` (`:727`). |
| `marketingConsent` / `marketingConsentAt` | `:27` | Défaut `false`. |
| `isDemo` | `:42` | Compte vitrine, lecture seule. |
| `onboardingCompleted` | `:46` | Défaut `false`. |
| `referralCode` / `referredBy` | `:70` | Parrainage. |
| `acquisitionSource/Medium/Campaign` | `:77` | UTM. |
| `discordId String? @unique` | `:89` | Précédent d'identifiant externe unique : `googleId` suivra le même modèle. |

---

## 3. Ce qui est capté à l'inscription et doit survivre au flux Google

| Donnée | Où elle est captée | Comment elle arrive en base | Impact Google |
|---|---|---|---|
| **Code parrain** (`?ref=VAL`) | `register.component.ts:140` `resolveReferralCode` : URL prioritaire, sinon `localStorage mtc_ref` | `RegisterDto.referralCode` (`dto/register.dto.ts:24`) → validé contre `User.referralCode` (`auth.service.ts:100`) → `referredBy` | À transmettre dans le corps de `POST /auth/google`. Effets en aval déjà branchés sur `referredBy` (essai/remise au checkout `stripe-billing.service.ts`, commissions `stripe-referral.service.ts`). |
| **UTM / source** | `register.component.ts:106` `resolveAcquisition` : URL → `sessionStorage mtc_utm` → hôte du referrer (`referrerHost`) | `acquisitionSource/Medium/Campaign` (`dto/register.dto.ts:36`, normalisés minuscules), effacés après succès (`register.component.ts:214`) | À transmettre tels quels ; même normalisation (réutiliser le `Transform`). |
| **Code promo** (`?promo=CODE`) | `core/services/offer-intent.service.ts` → `sessionStorage mtc_offer_intent` (`capture`, appelé `register.component.ts:80`) | **Rien à l'inscription.** Appliqué après coup par la modale de plans (`PartnerRedemption`, `partner-code.service.ts:337`) | Purement front : aucun changement API. Le flux GIS en popup ne quitte pas la page → l'intention reste en sessionStorage. Il suffit de reprendre la même navigation post-succès que `onRegister`. |
| **Offre fondateur** (`?plan=founder`) | Même `OfferIntentService` | **Rien à l'inscription.** Place prise au checkout (`founder-offer.service.ts:292`) | Idem promo. |
| **Premium direct** (`?plan=premium`) | `isPremiumFlow` (`register.component.ts`) | `billing.startCheckout` après succès | Idem : reprendre la même branche. |
| **CGU** | **Pas de case.** Acceptation implicite : CGU §1 « En créant un compte, l'utilisateur accepte sans réserve les présentes CGU » (`apps/landing-mytradingcoach/src/pages/cgu.astro:32`) ; le formulaire n'affiche même pas de lien CGU | — | Rien d'obligatoire. Recommandé : une phrase avec lien CGU + confidentialité sous le bouton Google et sur l'écran de finalisation (et, au passage, sur le formulaire e-mail). |
| **Opt-in marketing** | Case non cochée `register.component.html:139` | `marketingConsent` + `marketingConsentAt` (`auth.service.ts`, création) | Inscription Google → `false` en base, case explicite sur l'écran de finalisation. |
| **Post-inscription** | `register.component.ts` `next:` | offre → `/dashboard` + modale ; premium → checkout ; sinon `/dashboard` (onboarding par la sidebar) | Factoriser cette navigation pour la partager entre e-mail et Google. |
| **Entonnoir** | `SignupFunnelService` (`register_submit`, `register_success`, `register_error`), liste fermée `libs/shared/src/signup-funnel.ts` | `FunnelEventDaily` (anonyme) | Pas d'étape par méthode aujourd'hui. Mesure email/Google : voir §6. |
| Setups par défaut, e-mail de bienvenue, push admin | `auth.service.ts:146`, `:158`, `:165` | — | À factoriser dans une méthode commune de création pour que Google ait exactement les mêmes effets. |

---

## 4. Écrans Angular et landing

- **App** : `features/auth/register.component.{ts,html,css}` et `login.component.{ts,html,css}` ; `forgot-password` et `reset-password` sans CSS dédié.
- **Contrainte de bundle** (`angular.md`, « `/register` sans import paresseux ») : tout ce qu'importe l'inscription part dans le bundle initial (≈ 474 kB, budget bloquant 500 kB). Le script GIS doit donc être **chargé à la demande depuis `https://accounts.google.com/gsi/client`** (balise `<script>` injectée, aucune dépendance npm côté front), et seulement si la fonctionnalité est active.
- **Navigateurs intégrés** : `isInAppBrowser` / `IN_APP_UA_PATTERN` existent déjà (`libs/shared/src/signup-funnel.ts:54`) et couvrent Instagram, Facebook, TikTok, Line. Google bloque l'OAuth dans ces webviews (`disallowed_useragent`) : afficher directement « Ouvre dans ton navigateur pour te connecter avec Google » à la place du bouton, sans tenter la popup.
- **Landing Astro** : **aucun formulaire d'inscription** (seul formulaire : candidature ambassadeur, `pages/ambassadeur.astro:98`). Les CTA mènent à `app…/register` avec `ref`, `utm_*`, `plan`, `promo`. Rien à faire côté landing hormis la politique de confidentialité.

---

## 5. Domaines par environnement (origines JavaScript autorisées Google)

| Env | App (origine GIS) | API (vérifie `aud`) | Source |
|---|---|---|---|
| Local | `http://localhost:4200` **et** `http://localhost` (GIS exige les deux en local) | `http://localhost:3001` | `environment.ts`, `.env.example:98` |
| Dev | `https://dev.app.mytradingcoach.app` | `https://dev.api.mytradingcoach.app` | `environment.dev.ts` |
| Beta | `https://beta.app.mytradingcoach.app` | `https://beta.api.mytradingcoach.app` | `environment.beta.ts` |
| Prod | `https://app.mytradingcoach.app` | `https://api.mytradingcoach.app` | `environment.production.ts` |

L'app admin n'est pas concernée (connexion ADMIN par mot de passe uniquement, cf. §6).

---

## 6. Points de vigilance et recommandations (à valider avant l'étape 1)

### 6.1 Prise de compte par pré-inscription — **à trancher**
Sans vérification d'e-mail, quelqu'un peut aujourd'hui créer un compte e-mail/mot de passe sur l'adresse d'une autre personne. Si cette personne se connecte ensuite avec Google, la règle « e-mail existant → on relie » lui ouvre un compte dont **l'attaquant connaît le mot de passe** et dont il garde un refresh token valable 7 j (pas de révocation).
**Recommandation** : au moment de la liaison, si le compte n'a jamais prouvé son e-mail, **supprimer le mot de passe existant** et **révoquer les sessions** (nouveau champ `tokenVersion` inclus dans le refresh token et comparé dans `refresh`). Le vrai propriétaire peut redéfinir un mot de passe par e-mail. Ajouter `emailVerifiedAt DateTime?` (posé par Google et, plus tard, par une éventuelle confirmation d'e-mail). Pour un compte qui a déjà un historique réel (trades), le risque est quasi nul, mais la règle reste simple et uniforme.

### 6.2 Comptes exclus de la liaison
- `isDemo` : refus (403).
- `ADMIN` : refus de liaison et de connexion Google (l'admin garde le mot de passe seul, surface d'attaque minimale).

### 6.3 Casse de l'e-mail
Recherche d'un compte existant en **insensible à la casse** (`mode: 'insensitive'`) côté Google. Hors périmètre mais à noter : normaliser l'e-mail en minuscules à l'inscription et à la connexion classiques (sinon `A@x.com` et `a@x.com` peuvent coexister). À vérifier en base avant toute contrainte.

### 6.4 « Mot de passe oublié » pour un compte Google sans mot de passe
Le prompt demande de proposer Google ; l'anti-énumération impose une réponse identique. **Recommandation** : la route garde son 204 ; l'e-mail envoyé à un compte sans mot de passe dit « Ton compte utilise la connexion Google » et contient quand même le lien pour **définir** un mot de passe. Aucune fuite d'information, et c'est le même chemin que Profil > « Définir un mot de passe ».

### 6.5 « Définir un mot de passe » dans le Profil
Le bouton « Modifier » envoie déjà l'e-mail de réinitialisation (`profile.component.ts:432`). **Recommandation** : réutiliser ce flux (libellé « Définir » si pas de mot de passe) plutôt qu'une nouvelle route : il prouve la possession de l'e-mail et n'ajoute aucune surface. `ME_SELECT` exposera `hasPassword` et `googleLinked` (booléens, jamais l'identifiant Google).

### 6.6 Délier Google
`DELETE /auth/google` (authentifié) : refus 400 si `password` est null. Invalidation `userCache` ensuite.

### 6.7 « Compte supprimé »
La suppression est physique : il n'existe plus de compte à refuser. Une connexion Google avec l'e-mail d'un compte supprimé crée un **nouveau** compte, comme une réinscription par e-mail aujourd'hui. **Recommandation** : garder ce comportement (pas de blocage via `DeletedAccount`), et retirer ce cas de la liste des erreurs front.

### 6.8 Écran de finalisation et taux de finalisation
**Recommandation** : `POST /auth/google` crée le compte immédiatement (`marketingConsent = false`) et renvoie `isNewUser: true` ; le front affiche l'écran de finalisation (case opt-in non cochée, rappel CGU/confidentialité, bouton « Continuer ») qui enregistre le choix via la route de préférences existante, puis reprend la navigation post-inscription. Un abandon laisse un compte valide sans consentement, ce qui est conforme.
Mesure : `authProvider` (`EMAIL | GOOGLE`) sur `User` pour la répartition des inscriptions, et `signupFinalizedAt DateTime?` pour le taux de finalisation des inscriptions Google, agrégés avec `REAL_USERS` (`users.service.ts:253`).

### 6.9 Configuration par environnement et feature flag
API : `GOOGLE_CLIENT_ID` et `FEATURE_GOOGLE_AUTH` (off si absent). Front : plutôt que des valeurs dans `environment.*.ts`, une route publique `GET /auth/google/config` → `{ enabled, clientId }` (cache 5 min) : une seule source de vérité, activation sans rebuild, rien en dur. L'ID client n'est pas un secret, mais il reste piloté par l'environnement.

### 6.10 Rate limit et logs
`POST /auth/google` : mêmes limites que `/auth/login` (`default` 10/min + `ip` 30/10 min) ; la clé « IP + e-mail » ne s'applique pas (l'e-mail est dans le token) → compter par IP. Logs : jamais l'ID token, ni l'e-mail, ni le `sub` Google ; seulement l'issue (`created | linked | login | refused:<raison>`) et l'id interne.

### 6.11 Constats annexes (hors périmètre, pour mémoire)
- `DELETE /users/me` prend un `@Body()` typé en ligne (`users.controller.ts:85`) : non validé par le `ValidationPipe`, contraire à la règle de `security.md`.
- La politique de confidentialité liste encore **Vercel** comme hébergeur du front (`politique-confidentialite.astro`, §4), alors que les fronts sont sur les VPS OVH.
- Refresh token sans rotation ni révocation : le `tokenVersion` proposé en 6.1 le corrigerait aussi pour la déconnexion et le changement de mot de passe.

---

## 7. Plan de migration Prisma proposé (additif)

```prisma
password         String?               // nullable : comptes Google sans mot de passe
googleId         String?   @unique
authProvider     AuthProvider @default(EMAIL)  // méthode de création du compte
emailVerifiedAt  DateTime?
signupFinalizedAt DateTime?            // écran de finalisation Google validé
tokenVersion     Int       @default(0) // révocation des refresh tokens

enum AuthProvider { EMAIL GOOGLE }
```

Les comptes existants restent `EMAIL`, `emailVerifiedAt = null`, `tokenVersion = 0` : aucun backfill nécessaire.
