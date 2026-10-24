---
name: angular
description: "Conventions de l'app et de l'admin Angular (signals, zoneless, libs front partagées, modales, erreurs, routes). À lire avant tout travail dans apps/app-mytradingcoach ou apps/admin-mytradingcoach."
---

# Agent Angular — app-mytradingcoach

## Stack
Angular 22 · Signals · Standalone Components · @lucide/angular · Vitest · Nx 23 · TypeScript 6.0

---

## Règles Angular 22 — ABSOLUES

- `@if` / `@for` / `@switch` dans les templates — jamais `*ngIf` / `*ngFor`
- `inject()` plutôt que constructeur
- `DestroyRef` à la place de `ngOnDestroy`
- `signal()`, `computed()`, `effect()`, `toSignal()` — signals partout
- `@defer` pour le lazy loading des composants lourds
- Standalone Components exclusivement — pas de NgModules
- Prefix composants : `mtc-`
- Icônes : `@lucide/angular` exclusivement (jamais d'autres libs d'icônes). Motif :
  `<svg [lucideIcon]="XIcon" [size]="16" class="…" />` avec `LucideDynamicIcon` dans `imports`
  et `import { LucideX as X } from '@lucide/angular'` (le `<svg>` EST l'icône, classe `lucide`
  posée par la librairie → CSS sur `svg.lucide`, jamais sur `lucide-icon`). La librairie réécrit
  l'attribut `class` à chaque rendu : pas de `[class.x]` sur l'icône, passer par `[class]`.
- CSS dans `.css` uniquement — jamais inline dans `.ts`
- `OnPush` sur les composants sans signals

---

## Structure

```
src/app/
├── core/
│   ├── auth/       auth.service.ts · auth.guard.ts · auth.interceptor.ts
│   ├── api/        trades.api.ts · analytics.api.ts · debrief.api.ts · ai.api.ts
│   │               admin.api.ts · vps.api.ts
│   │               session.api.ts      ← V2 (TradingSession, LiveStats, SessionTrade, MoodState)
│   │               eco-calendar.api.ts ← V2 (EcoEvent, EcoCalendarData, EcoResultAnalysis)
│   │               daily-recap.api.ts  ← V2 (DailyRecap)
│   └── stores/     trades.store.ts · user.store.ts
│                   user.store : isBeta = computed(() => role === 'BETA_TESTER' || 'ADMIN')
├── features/
│   ├── dashboard/          dashboard.component.ts + .html + .css (état, cadre, états vides)
│   │   ├── dashboard-charts.util.ts   ← calculs purs des viz (sparklines, donuts, P&L, coach)
│   │   ├── panels/                    ← viz présentationnelles : dashboard-kpis ·
│   │   │                                top-assets · pl-bars · coach-feedback · donut-chart ·
│   │   │                                recent-trades-table
│   │   └── components/
│   │       ├── session-morning/  ← V2 : vue pré-session (mood, recap hier, objectifs, éco calendar)
│   │       │   session-morning.component.ts + .css
│   │       └── session-live/     ← V2 : vue session active (cadre + mini-stats)
│   │           session-live.component.ts + .css
│   │           └── components/   live-eco-calendar · live-feed · quick-trade · live-news
│   ├── journal/            journal.component · trade-form.component
│   │                       csv-import.component   ← import historique GRATUIT (tous plans)
│   │                       (register : « trades illimités, sans CB » ;
│   │                        levier d'acquisition, dispo onboarding + bouton CSV du Journal)
│   ├── analytics/          analytics.component · heatmap.component
│   ├── ai-insights/        ai-insights.component · insight-card.component
│   ├── weekly-debrief/     debrief.component · debrief-objectives · debrief-emotions
│   ├── scoring/            scoring.component
│   ├── profile/            profile.component (route /profil)
│   ├── today-session/      today-session.component (route /session)
│   └── auth/               login.component · register.component
├── shared/
│   ├── components/  sidebar/ · topbar/ · stat-card/ · badge/ · locked-feature/
│   └── pipes/       pnl-color.pipe.ts · pnl-format.pipe.ts · emotion-emoji.pipe.ts
│                    session-label.pipe.ts · setup-color.pipe.ts
├── app.component.ts
├── app.config.ts
└── app.routes.ts
```

### Imports

Au-delà de 2 niveaux de `../`, utiliser l'alias : `@app/core/…`, `@app/shared/…`, `@app/features/…`,
`@app/environments/environment` (admin : `@admin/…`). Déclarés dans `tsconfig.base.json` et dans
`resolve.alias` de `vitest.config.mts` (le plus précis en premier).

### URL → dossier

Les URLs restent en français (liens des emails, favoris) ; les dossiers sont en anglais.

| App — URL | Dossier `features/` | Admin — URL | Dossier `features/` |
|---|---|---|---|
| `/dashboard` | `dashboard` | `/dashboard` | `dashboard` |
| `/session` | `today-session` | `/users`, `/users/:id` | `users`, `user-detail` |
| `/journal` | `journal` | `/subscriptions` | `subscriptions` |
| `/sessions` | `sessions` | `/revenue` | `revenue` |
| `/accounts` | `accounts` | `/deleted` | `deleted` |
| `/analytics` | `analytics` | `/surveillance` | `monitoring` |
| `/ai-insights` | `ai-insights` | `/backups` | `backups` |
| `/debrief` | `weekly-debrief` | `/ai-usage` | `ai-usage` |
| `/scoring` | `scoring` | `/emails` | `emails` |
| `/eco-calendar` | `eco-calendar` | `/ambassadeurs` | `ambassadors` |
| `/profil` | `profile` | `/parrainage` | `referral` |
| `/ambassador` | `ambassador` | | |
| `/parrainage` | `referral` | | |
| `/devenir-ambassadeur` | `become-ambassador` | | |
| `/login`, `/register`, `/demo`… | `auth` | | |

### « Ma session » — route `/session` (générale, tous plans)

`today-session.component.ts` (features/today-session/) : shell à 3 onglets aligné sur
la maquette design (« The Terminal »).

```typescript
// activeTab = signal<'morning' | 'live' | 'debrief'>('morning')
// effect() auto-switch vers 'live' si activeSession()?.status === 'ACTIVE'
// Chargement : GET /session/today. Session du jour déjà clôturée (page rechargée, ex. mobile
// en arrière-plan pendant « Publier ») → réaffichée sur l'onglet Débrief une fois, trades de la
// session + totaux de la session (debriefStats) — sinon retour Pré-session et session vide (#456)
// Polling visibleInterval(30s) pour refreshLiveStats() pendant session active (SessionStore, SCA-B4)
```

- **Shell** : `mtc-topbar` en **mode hero** (`[heroHeader]="true"`) — titre « Ma session »
  + date · compte **empilés sur 2 lignes**, segmented control (icônes Lucide
  Sunrise/Activity/Moon) **centré sur la ligne du header** via le slot `[topbar-center]`,
  action à droite « Démarrer la session » (vert) / pill « Session active + timer » +
  « Clôturer ». La **sidebar se replie en icônes pendant qu'on regarde l'onglet Session
  live**, et seulement là : l'effet de `sidebar.component` suit
  `LiveModeService.isLive()`, posé par `session-day` sur `activeTab === 'live'` et retiré
  au changement d'onglet comme en quittant la route. Le déclencheur était
  `SessionStore.hasActiveSession()` — un état qui dure toute la séance, donc la sidebar
  restait repliée sur le Dashboard et le Journal, bien après avoir quitté le live. L'état
  d'avant est restauré en sortant, et le repli/dépli manuel tient (l'effet lit
  `collapsed()` dans un `untracked`, il ne se redéclenche pas). La préférence localStorage
  n'est jamais écrasée : `collapsed.set` ne l'écrit pas, seul `toggleCollapse` le fait.
- **Onglet Pré-session** → `session-morning.component` (features/dashboard/components/) :
  carte Prépare (mood/plan/compte projeté) + Hier + Objectifs · Agenda du jour IA.
- **Onglet Session live (v3, #593, retours de Val « trop chargée »)** → `session-live.component`,
  **mobile d'abord** (base = 390 px, `@media (min-width)` uniquement, jamais `max-width` dans cette vue).
  Ordre mobile (= ordre du DOM) : `mtc-live-bar` (bandeau `position: sticky`) → `mtc-live-next-event`
  → grille plate `.lv-grid` (`mtc-live-position`, `.lv-account`, `.lv-closed`) → `.lv-actions`
  (« Contexte marché » + « Clôturer la session », en BAS, loin de « Clôturer ce trade »).
  Paliers : **≥ 768** bandeau sur une ligne (Contexte + clôture dedans, `.lv-actions` masqué), grille
  `pos | acc` puis `closed` pleine largeur · **≥ 1100** grille 2/3 · 1/3 (`"pos acc" "closed acc"`),
  compte + plan et tickers dans le bandeau, suivi prop firm étiré sur la hauteur.
  Retirés : 4 mini-stats, bandeau news, calendrier pleine hauteur, live feed (le calendrier complet
  reste en Pré-session). Contexte marché (8 tickers) + news → feuille `mtc-market-context-bar` +
  `mtc-live-news` (plein écran mobile, panneau latéral ≥ 768, `mtcDialog`).
  Logique pure dans **`session-live.util.ts`** (testée) : `positionBar`, `priceFromLatent`, `pointValue`
  (table `GET /instruments`, tickValue / tickSize), `nextAnnouncement`, `closeKind`, `bannerTickers`
  (NQ, **SPX** — le flux n'a pas l'ES, jamais renommé —, DXY, 10Y), `moodLabel`, `planKindShort`.
  - **Bandeau** (`live-bar`) : chrono `SessionStore.sessionClock()` (`HH:MM:SS`, ou alerte « Session
    ouverte depuis le JJ/MM, clôture-la » au-delà de 24 h, `session-clock.util.ts`), `Trades N / max`
    (`User.tradesPerDayMax`, sinon `Trades N`), P&L du jour = réalisé + latent (`liveTotals`), réalisé
    seul si le latent est inconnu. **Sous 1100 px**, le contexte marché **défile** sous le chrono
    (`lb-tape` : NQ, SPX, DXY, taux 2/10/30 ans, valeurs inconnues masquées, deux copies pour la
    boucle, pause au survol, figé en `prefers-reduced-motion`) ; le toucher ouvre la feuille Contexte
    (le bouton « Contexte marché » du bas n'apparaît plus que si le contexte n'est pas chargé). Sur l'onglet live, la pilule « Session active » du header de la
    page est masquée (le bandeau la remplace) ; « Clôturer la session » émet `closeSession` → le
    parent ouvre sa confirmation.
  - **Prochaine annonce** (`live-next-event`) : prochaine annonce non publiée du jour, compte à rebours
    recalculé chaque minute, **absente** s'il n'en reste aucune. Annonces à la même heure regroupées
    (`nextAnnouncement` → `events`, `byImpact`), couleur rouge / ambre selon l'impact le plus fort. Marché CME fermé (ven. 16:00 →
    dim. 17:00 Chicago, `cmeClosed`) : « Marché fermé · Réouverture des futures <jour HH:MM> » à la
    place (la démo montre sa session live même le week-end). Sur `EcoSocketService.newReleases$`,
    la ligne passe à « publiée » : chiffre publié / prévu / précédent, 1re phrase de l'analyse IA
    (`analyze-result`), reste dépliable ; retour à la suivante sur « J'ai lu » ou après 15 min.
    Mêmes appels que l'ancien calendrier live (`refreshAnalysis` → `ecoCalendarRefreshed`, puis une
    analyse par annonce) : **aucun appel IA de plus**.
  - **Trade en cours** (`live-position`) : une position (broker si rôle `LIVE_POSITION_ROLES` et
    `liveStats.broker`, sinon 1er trade saisi à la main sans sortie), latent 32 px (40 px PC), barre
    SL / entrée / TP (axe toujours perte → gain, SHORT compris). Broker : SL/TP = `stopPrice` /
    `targetPrice` de la position (ordres actifs lus en direct, #601) ; `null` → repli entrée → prix +
    « Aucun stop détecté chez Tradovate ». Événement socket `tradovate:orders` → `refreshLiveSoon` ; prix déduit du
    latent (`priceFromLatent`) avec « relevé à HH:MM:SS », **masqué si plusieurs positions**.
    « Clôturer ce trade » **uniquement pour un trade saisi à la main** (lecture seule Tradovate) :
    prix de sortie → `tradeClosed`. Aucune position → carte d'une ligne `live-position-none`.
  - **Suivi du compte** (`live-prop-firm`) : equity sur une ligne (30 px « Equity en direct » +
    réalisé en PC), puis 3 jauges **le risque avant le gain** : perte max du jour (Premium, sinon
    teaser à la même place et même hauteur, 78 px) → marge avant le plancher → objectif. Compte non
    synchronisé / perso : carte P&L du jour + « Lier un compte prop firm », et **Trade rapide reste
    affiché** (seul moyen de logger un trade) ; compte synchronisé : Trade rapide sur « Saisir un
    trade à la main » (lien masqué quand Trade rapide est déjà là).
  - **Trades clôturés** (`live-closed-trades`) : 2 niveaux en mobile (sens + actif + résultat ; heure
    · entrée → sortie · TP/SL/Manuel), grille alignée ≥ 768 (`display: contents` sur les 2 niveaux).
- **Colonne suivi prop firm** : compte de la session **éval ou funded synchronisé Tradovate**
  (`isLivePropAccount`, `live-prop-firm.util.ts`). `SessionLiveComponent` charge lui-même
  `TradovateStore` s'il ne l'est pas (sinon bloc masqué en ouverture directe / après F5, #437).
  Solde et latent du broker, marge avant le plancher et avancement objectif / payout, tout calculé
  par l'API (`metrics` de `GET /accounts`, règles du plan relié). Temps réel = `tradovate:balance` →
  `SelectedAccountStore.reloadSoon()` ; le panneau ne fait qu'UNE relecture `refreshBalance` à
  l'ouverture (jamais en compte démo).
- **Latent broker (bêta, rôles `LIVE_POSITION_ROLES` : BETA_TESTER, ADMIN, AMBASSADOR)** : relevé
  daté, « Actualiser » = `refreshBalance` (bridé 20 s côté API) puis `refreshLive`. Rafraîchi par
  `tradovate:balance` → `SessionStore.refreshLiveSoon()` (rafale → 1 relecture). Jamais de polling
  rapide : le latent ne bouge qu'aux événements du compte. Latent inconnu → « Latent indisponible
  pour ce compte », jamais un chiffre.
  **Cohérence avec le suivi du compte** : les deux panneaux lisent le même relevé broker par deux
  requêtes (`GET /session/today/stats` sondé 30 s, `GET /accounts`). `SessionLiveComponent`
  compare `liveStats.broker.openPnlAt` et `metrics.broker.equityAt` (`laggingBrokerPanel`) et relit
  le panneau en retard, une fois par écart (pas de boucle). Côté API, « à plat » = compteur
  `brokerOpenPositions` en base pour les deux (Redis = détail des lignes seulement).
  Position ouverte au latent jamais lu → « - » dans les deux (`broker.openPnlKnown` côté comptes,
  `openPnl: null` côté session), jamais 0.
- **News live (ticker)** : vitesse constante (`SPEED_PX_S` = 40 px/s) — durée d'animation calculée
  sur la longueur mesurée d'un tour (`ResizeObserver`), jamais une durée fixe (trop rapide à 20 titres).
- **Alertes prop firm (#370, PREMIUM)** : `prop:alert` (canal `/tradovate-live`) →
  `PropAlertsService` (core/services) : toast (`warning` temporaire ; `critical` / `breached` en
  `error` sans durée) + `Notification` système si autorisée (`tag` compte:type, une alerte
  remplace la précédente). Autorisation demandée sur un clic, depuis le panneau de la session live.
  Le panneau affiche « Perte du jour » si `metrics.dailyLoss` (calculée côté API pour le Premium
  seulement) ; compte gratuit relié à un plan → teaser PREMIUM qui ouvre `mtc-plan-modal`.
  Ligne « Consistency : encore X $ de gain max aujourd'hui » (ou dépassée) si le requirement
  consistency porte `dayCap` (Premium). Bonnes nouvelles (`level: 'reached'`, objectif / payout) →
  toast de succès sans durée, notification « bonne nouvelle ».
  Anti-tilt (#371) : `tilt:alert` → `PropAlertsService.handleTilt` : toast `warning` de 15 s
  (non bloquant, une question, jamais un ordre), humeur de pré-session citée seulement si
  « fatigué » / « stressé », notification « pause ? ».
  **Son** (`AlertSoundService`, core/services) : motif Web Audio généré (aucun fichier) par
  gravité — `tilt` grave et doux, `warning` deux bips, `critical` (critique ou dépassé) trois bips
  aigus, `reached` arpège montant. Activé par défaut, bouton cloche du panneau de la session live
  (Premium) pour le couper ; préférence de l'appareil en `localStorage` (`mtc.alertSound`).
  Autoplay : le contexte audio se débloque au premier clic / touche de la page ; avant, l'alerte
  reste silencieuse (toast et notification s'affichent quand même).
- **Onglet Débrief** (inline dans session-day) : 4 stats · analyse (mood fin, score de
  discipline, meilleur/pire trade, émotions, objectifs) · journal pleine hauteur à droite.

#### Carte de résultats + « Publier mes résultats » (bêta, #391)

Onglet Débrief, sous les 4 stats, **session `CLOSED` + rôle `BETA_TESTER` / `ADMIN` /
`AMBASSADOR`** (`canPublishResults`, `RESULTS_SHARE_ROLES` dans `results-card.util.ts` ;
pas de route guard : c'est un bouton). Ouverture à tous seulement après un retour bêta
positif explicite. `features/today-session/results-share/` (bouton +
modale) rend hors écran `shared/components/results-card/` (1080×1080 ou 1080×1920, maquettes
de l'artefact « Carte de résultats — partage Instagram ») et la convertit en PNG avec
`html-to-image` chargé à la demande (`import()`), `pixelRatio: 1`. **Rien ne part au serveur.**

- Lien : code de `GET /referral/me` (généré pour tout user) ; échec → domaine seul, jamais `VAL` en dur.
- Mobile (`navigator.canShare({ files })`) : un bouton → `navigator.share`. Le PNG est généré
  **avant** le clic : Safari iOS refuse `share()` hors du geste utilisateur. Desktop : Télécharger +
  Ouvrir Instagram. L'UI ne promet jamais de lien cliquable sur Instagram (rappel sticker/bio).
- Graphique optionnel (screenshot de l'utilisateur) : `image/*`, 10 Mo max, décodé et réduit à
  1600 px en local (une photo pleine taille fait échouer le rendu sur iPhone) → deux panneaux,
  côte à côte en carré, **empilés en Story** (540×1920 rendrait un graphique paysage illisible).
- Rien à partager si 0 trade ou P&L nul : bouton désactivé « Rien à partager aujourd'hui ».
- La carte est capturée via `querySelector` depuis l'hôte, pas `viewChild()` : en JIT sous
  vitest, les requêtes signal ne se résolvent pas plus que les entrées signal.
- Un onglet en arrière-plan suspend le rendu (`toBlob` ne rend pas la main) : normal, il reprend.

Le compagnon de session (pré-session + live + débrief de base) est **FREE** ; le gating
IA (contexte marché, news, calendrier éco IA, recap) suit `plans.md`. Données chargées
via `SessionStore` : `/session/active`, `/analytics/daily-recap/yesterday`,
`/eco-calendar/*`, `/debrief/current`, `/trades/market-context`, `/trades/news`.

### Wizard onboarding : checkpoint unique et z-index (PROMPT-198/199)

**Rien n'est persisté avant l'étape Stratégie.** Le wizard accumule ses choix dans des
signaux + un snapshot localStorage (`mtc.onboarding.progress`), et ne fait ses appels
réseau qu'à `saveProfileThenGoAssets()` — profil IA **puis** création du compte de
trading déclaré à l'étape 3. Toute nouvelle donnée d'étape suit ce schéma : signal,
champ dans `OnboardingProgress`, restauration dans `restoreProgress()`, envoi au
checkpoint. Ne pas ajouter d'appel réseau au clic « Continuer » d'une étape isolée.

**Le checkpoint est rejouable** : un retour arrière depuis l'étape Actifs puis une
ré-avance le redéclenche. Toute création faite là doit donc être idempotente. Pour le
compte de trading, deux filets : un flag mémoire (`accountCreated`, posé **avant**
l'appel, pour le double-clic) **et** un `getAll()` préalable — le flag seul ne survit ni
au rechargement, ni au localStorage vidé, ni à un second onglet. Chacun est couvert par
son propre test.

**Le compte est créé à l'onboarding, plus au premier trade.** `ensureDefaultAccountId`
(back) reste le filet, mais il produit un PERSONAL « Compte principal » sans règles :
c'est le mauvais compte pour la cible prop firm. L'étape 3 capture perso/prop firm,
broker, objectif et drawdown, tous optionnels — un `profitTarget: 0` n'est **pas**
envoyé, sinon « Mes comptes » affiche une barre d'objectif vide au lieu de masquer la
carte de règles.

**Un checkpoint qui échoue ne doit jamais avancer.** La branche `error` de
`saveProfileThenGoAssets` faisait `step.set(6)` comme la branche `next` : l'appel
échouait, le wizard avançait, l'utilisateur terminait avec un profil vide sans le
moindre signal (constaté en base sur dev). Règle : un appel réseau porteur de données
ne se solde jamais par une avancée silencieuse — on reste sur l'étape, on affiche
`err.error?.message` avec un repli lisible, et on offre **réessayer** *et* **continuer
quand même**. Bloquer serait aussi faux : le wizard doit toujours laisser sortir.

**Z-index — hiérarchie de l'app** : `300` overlay onboarding · `1000` modales
top-level (csv-import, plan-modal, setup-form-modal, session-live fullscreen) ·
`10000` toasts (`styles.css`). Une modale partagée ouverte **depuis** le wizard doit
être au palier 1000 : à 200, `setup-form-modal` s'ouvrait sous l'overlay et
« + Ajouter un setup » semblait mort. jsdom ne calcule aucun contexte d'empilement,
donc aucun test de rendu n'attrape ça — l'invariant est verrouillé en lisant les deux
CSS (`onboarding-friction.spec.ts`).

### Un défaut positionnel se réévalue dans ton dos (journal)

`isWeekCollapsed(key, index)` retombait sur `index !== 0` quand l'utilisateur n'avait
rien choisi : « seule la plus récente est ouverte ». Le défaut dépendait donc de la
POSITION, qui bouge. Logger un trade dans une semaine plus récente décalait la semaine
consultée de l'index 0 à l'index 1 et la repliait toute seule — le journal semblait se
vider au moment précis où on venait d'y ajouter quelque chose.

Règle : un état d'affichage dont le défaut dépend du rang dans une liste doit être
**figé à l'apparition de l'élément** (`freezeNewWeeks`), pas recalculé à chaque rendu.
L'override explicite de l'utilisateur reste prioritaire et n'est jamais écrasé.

### Stores : un compteur à 0 n'est pas une donnée (PROMPT-196)

`TradesStore` expose `loaded` **en plus** de `totalTrades`, comme `SelectedAccountStore`.
Sans lui, `totalTrades() === 0` était ambigu — avant tout chargement, PENDANT un
reset+recharge, et pour un compte réellement vide. Le dashboard lisait ce 0 comme
« compte vide » et affichait « Fais ton premier pas » juste après un import réussi :
l'utilisateur venait d'importer son historique et lisait « tu n'as rien fait ».

Règle : **ne jamais conclure « vide » depuis un compteur seul**. Un état vide se déduit
de `loaded() && total === 0`. Le dashboard passe par `accountReallyEmpty()`.
`loaded` ne passe à `true` que sur une réponse **reçue** (pas sur erreur) et retombe à
`false` dans `reset()` : après un échec ou pendant un rechargement, l'état est
« inconnu », jamais « il n'a rien ».

Corollaire pour l'auto-élargissement de la fenêtre : ne pas désarmer sur un compte vide
(`periodAutoAdjusted`), sinon l'import qui suit n'élargit plus jamais la période.

#### Hauteurs calées sur le viewport → `--demo-banner-h` (PROMPT-192)

Les 3 onglets se dimensionnent en `calc(100vh - 103px - var(--demo-banner-h, 0px))`
(≥981px). Le `103px` suppose que `.session-page` colle au haut du viewport — faux en
mode démo, où le bandeau « Mode démo » s'intercale dans `.main-content` : la vue
débordait de 52 px et créait un scroll parasite sur des écrans conçus pour tenir
dans la fenêtre.

`--demo-banner-h` est publiée par `.main-content.has-demo-banner` (sidebar.component.css),
vaut `0px` hors démo, et le bandeau a une **hauteur fixe égale à la variable**
(`flex: 0 0 var(--demo-banner-h)`, `flex-wrap: nowrap`) pour que l'offset ne puisse pas
mentir. Sous 768px : 40px, la phrase longue (`.demo-banner-long`) tombe, le CTA reste.

**Toute nouvelle vue calée sur `100vh` doit retrancher `var(--demo-banner-h, 0px)`.**

---

## Pipes obligatoires — ne jamais dupliquer la logique

```typescript
// Toujours utiliser les pipes, jamais de logique inline
PnlColorPipe      // couleur verte/rouge selon pnl
PnlFormatPipe     // montant signé dans la devise NATIVE du compte : {{ t.pnl | pnlFormat : t.entry : t.accountId }}
MoneyPipe         // idem avec décimales / sans « + » : {{ pnl | money:0 }}, {{ fees | money:2:false }}
EmotionEmojiPipe  // emoji selon état émotionnel
SessionLabelPipe  // label lisible de la session
SetupColorPipe    // couleur selon setup
```

**Devise = propriété DU COMPTE, ZÉRO conversion, AUCUNE préférence globale** (PROMPT-213/214) :
un montant s'affiche dans la devise de son compte de trading (`TradingAccount.currency`), tel que
reçu — un compte prop firm en USD s'affiche en USD pour tout le monde. Source UNIQUE front + back :
`@mtc/shared` (`libs/shared/src/currency.ts`) — `ACCOUNT_CURRENCIES` (USD, USDT, EUR : sélecteurs
de l'onboarding et de la page Comptes, validation API), `formatMoney(value, currency)` (`$1.00`,
`€1.00`, `1.00 USDT` : code APRÈS le montant pour les devises sans symbole), `commonCurrency`.
- **Totaux de l'écran** : `MoneyService.format()` / pipes → `SelectedAccountStore.displayCurrency`
  (compte sélectionné, sinon devise commune de « Tous les comptes »).
- **Ligne de trade** : devise de SON compte → passer l'`accountId` (`pnlFormat : entry : accountId`,
  `MoneyService.formatFor`). `Trade.accountId` est exposé par l'API.
- **Devises mêlées en « Tous les comptes »** (`MoneyService.mixed()`) : pas de totaux (on
  n'additionne pas des USD et des EUR) → `<mtc-mixed-currency-notice />` (« choisis un compte ») à
  la place des KPI / courbes / calendrier (dashboard, analytics, résumé et totaux jour/semaine du
  journal) ; les lignes de trades restent, chacune dans sa devise. Formateur avec devise `null` →
  aucun symbole, jamais un symbole deviné.
- **Compte synchronisé** : devise imposée par le broker, sélecteur désactivé (`formSynced`) et refusé
  côté API. Onboarding : le choix USD / USDT / EUR est la devise du compte créé, rien au profil.
- **`User.currency` / `User.currencyRate` n'existent plus côté front** (plus de réglage « Devise
  d'affichage », plus de taux) : ne jamais réintroduire de conversion. **Jamais de `$` en dur**
  dans un template, un graphe Chart.js (`ChartService`) ou un libellé calculé (récaps d'import
  compris : devise du compte cible).

**P&L affiché = net** : un montant par trade se lit via `netPnl(t)` de `@mtc/shared`
(`pnl` brut − frais), jamais `t.pnl` brut (tableau des trades récents, live feed). Les agrégats de
l'API sont déjà nets. Le formulaire de trade envoie le **brut** (`form().pnl ?? autoPnl()`) et la
commission à part : envoyer `pnlNet` faisait déduire les frais deux fois.

**Courbe d'équité / drawdown** : composant partagé `mtc-perf-chart` (dashboard + analytics, style
dans `design.md`) → `ChartService` ; séries dans `chart-series.util.ts`, qui préfixe un point
« Départ » : un seul jour tradé trace déjà la courbe (`curve.length >= 1`). Les bornes de période
envoyées à l'API sont des horodatages ISO complets.

**Capital, courbe et drawdown : une seule définition** (`core/services/equity-period.util.ts`) :
- **Capital** (KPI du dashboard) = solde actuel de la vue (`viewBalance(…, 'currentBalance')`) : le
  même que le sélecteur de compte et Mes comptes (solde du broker pour un compte connecté). Jamais
  « capital de départ + P&L de la période ». Le % compare au solde du début de la période.
- **Courbe d'équité** : part de `periodStartBalance` = solde de départ + P&L d'avant la période
  (`before.pnl`), soit la taille du compte quand la période couvre son début (`before.count === 0`).
  Repli sans `before` (API ancienne) : solde actuel − P&L de la période. Un écart entre P&L 30 jours
  et P&L total = des trades avant la fenêtre, pas une erreur. **Jamais `startingCapital` de `/equity-curve/daily`** : c'est le capital du
  PROFIL (un compte de 50K partait de 100K dans Statistiques).
- **Drawdown** (KPI « Drawdown max », courbe et en-tête des Statistiques) = `anchoredDrawdown` :
  clôture de journée moins le plus haut des clôtures depuis l'ouverture du compte (`before.peak`
  renvoyé par l'API, solde de départ compris), comme la règle EOD des prop firms et la marge de
  Mes comptes. Plus `summary.maxDrawdown` à l'écran (trade par trade, pic remis à 0 en début de période).
- **Payouts reçus** (détectés chez le broker, `payouts` + `before.payouts` de l'API) : `withPayouts`
  les insère dans les points (jour sans trade = point au même P&L, champ `payout`). Seules les
  courbes de SOLDE les déduisent : équité, marge de la carte drawdown (`floorSeries`), sparkline du
  Capital (`payoutSeries`). Elles finissent ainsi sur le Capital, et la marge baisse le jour du
  payout au lieu de sauter au dernier point. Le P&L (KPIs, « Jour », drawdown « sous l'eau ») ne les
  voit jamais : un retrait n'est pas une perte. Le plus haut d'avant la période n'est pas abaissé par
  un payout (plancher inchangé). Comptes manuels : aucun payout (pas de saisie à ce jour).

---

## Responsive mobile — OBLIGATOIRE sur tous les composants

- `font-size: 16px` minimum sur tous les `input`, `select`, `textarea` — anti-zoom iOS Safari
- `min-width: 0` sur tous les items grid/flex — anti-overflow
- `overflow-x: hidden` sur les containers principaux — `.main-content` (sidebar) le porte : un
  `overflow-y:auto` seul passe `overflow-x` à `auto` et un enfant trop large fait glisser toute la page
- Grilles repliées en 1 colonne : `minmax(0, 1fr)`, jamais `1fr` nu (= `minmax(auto, 1fr)` : la piste
  s'élargit au min-content du contenu, ex. heatmap, champ de lien, profil → page plus large que l'écran)
- Barre flex passée en `flex-direction: column` : retirer le `flex-wrap: wrap` (avec le wrap, le
  stretch ne borne plus la largeur des enfants — filtres du Journal à 997 px)
- `overflow-x: hidden` sur `.main-content` **masque** un débordement, il ne le corrige pas : le
  contenu est rogné à droite (KPI, cartes). Toujours tester à **360 px** (le plus étroit courant) :
  rangée flex d'un item qui « wrappe » un enfant `flex:1` → l'item lui-même a besoin de
  `flex:1; min-width:0` (sélecteur de compte) ; valeur + visuel côte à côte dans une carte de
  ~156 px → `flex-wrap` ; en-tête titre + onglets → `flex-wrap`
- **Un seul scroll vertical sur mobile** : `.main-content`. Pas de bloc `overflow-y:auto` borné
  (`max-height`, `flex:1 + min-height:0`) sous 768px — Mes comptes, calendrier éco, live feed.
  Un débordement horizontal voulu (tableau, onglets, carrousel) porte son propre `overflow-x:auto`
- `padding-bottom: calc(env(safe-area-inset-bottom) + Xpx)` sur les footers fixes **et sur le
  conteneur de page** sous 768px (`.content` du dashboard / journal, `.session-page`) : avec
  `viewport-fit=cover`, sans ça la fin de la page passe sous la barre système iOS (#440)
- `height: 100dvh` plutôt que `100vh` — évite le bug Safari barre d'adresse
- `viewport-fit=cover` dans `index.html`

```css
/* Règle globale dans chaque composant .css */
@media (max-width: 768px) {
  input, select, textarea { font-size: 16px; }
}
```

---

## Tableau de lignes — pattern partagé (Journal · Mes comptes)

Une liste d'objets comparables (trades, comptes) s'affiche en **lignes alignées**, jamais en
grille de cartes : les cartes ne tiennent pas la montée en charge (6 comptes = un mur) et
laissent un trou quand le compte est impair. Le pattern, identique dans `journal.component.css`
et `accounts.component.css` :

- un **en-tête de colonnes** (`.table-header` / `.acct-thead`) et les lignes partagent LE MÊME
  `grid-template-columns` — deux déclarations à garder synchronisées, sinon l'alignement casse ;
- libellés d'en-tête en mono 9 px, majuscules, `letter-spacing: .1em`, `color: var(--text-3)` ;
- pas d'`overflow: hidden` sur le wrapper si une ligne ouvre un menu « … » : il serait coupé ;
- repli mobile : `.table-header { display: none }`, la ligne repasse en grille de 2-3 colonnes et
  chaque cellule retrouve son étiquette via `content: attr(data-label)` ;
- ce qui ne tient pas à l'écran étroit passe derrière un **dépli** (signal `expandedId`, une
  ligne ouverte à la fois), jamais derrière un scroll horizontal ;
- la bascule en repli suit la largeur du **tableau** (`container: acct-table / inline-size` +
  `@container acct-table (max-width: 980px)`), pas celle de la fenêtre : la barre latérale prend
  70 à 216 px, et un seuil en `@media` laissait les colonnes se chevaucher (Mes comptes à 1100 px).

⚠️ **Deux pièges de sélecteurs**, tous deux rencontrés en vrai sur « Mes comptes » :
- `:nth-of-type()` compte les **éléments** (tous les `div`), pas les classes : `.cell.num:nth-of-type(2)`
  ne désigne pas la 2ᵉ cellule numérique. Donner une classe explicite à chaque colonne
  (`.cell-balance`, `.cell-pnl`…) ;
- une règle de repli doit **battre en spécificité** la règle desktop : `.cell.num.right` (3 classes)
  gagne contre `.cell.num` même placé plus bas dans le fichier → écrire `.acct-line .cell.num.right`.

Les actions attendues par les tests (synchro, déconnexion) restent **dans le DOM sans interaction** :
les enfermer dans un menu `@if` casse les specs qui les interrogent au rendu.

---

## Features gated — règles obligatoires

⚠️ 2 paliers depuis PROMPT-169 : cf. `.claude/agents/plans.md` (source de vérité).
`isPremium()` = PREMIUM / trial / admin / beta. L'alias `isStarterOrAbove` a été
**supprimé**. L'IA **mutualisée** (contexte marché, news, calendrier éco IA) est **FREE**
(aucun gate front) ; la profondeur d'analyse + l'IA personnelle (analytics avancés, Weekly
Debrief, IA Insights, chat coach, score, recap 17h30) sont **PREMIUM** (`isPremium`).

**Premium offert par l'admin** (`UserStore.isOfferedPremium()`) : `trialEndsAt` futur **sans**
abonnement Stripe `active`/`trialing` (`AuthUser.stripeSubscriptionStatus`). Aucun prélèvement
prévu et pas de client Stripe → **jamais** de bouton portail ni de texte « premier prélèvement »
(Profil > Abonnement affiche « 🎁 Premium offert » + « Continuer en Premium → » qui ouvre la
modale de plans). `UserStore.trialAvailable()` (= `!trialUsed`) : la modale de plans ne promet
« 1 mois offert » que si l'essai est encore disponible, sinon le checkout facture tout de suite.
**Même règle sur TOUS les paywalls** (statistiques, score, insights, débrief, bannière du dashboard,
Profil, cadenas) : « Essayer Premium · 1 mois offert » si `trialAvailable()`, sinon « Passer à
Premium → » (et « Sans engagement · annulable en un clic » au lieu de « 1 mois offert · carte
requise »). Garde-fou : `plan-modal/trial-cta-copy.spec.ts` échoue sur une mention en dur.

**Pattern dans les composants qui gate une feature PREMIUM :**

```typescript
private readonly userStore = inject(UserStore);
// on utilise directement userStore.isPremium() dans le template
```

```html
@if (userStore.isPremium()) {
  <!-- feature accessible -->
} @else {
  <mtc-premium-lock title="Titre de la feature" subtitle="Disponible en Premium" />
}
```

Si l'API retourne `{ code: 'PREMIUM_REQUIRED' }` → afficher le lock (ou rediriger vers
`/settings`). Cohérence obligatoire aux 4 points de `plans.md`.

---

## Conventions CSS

```css
/* Variables à utiliser — jamais de valeurs hardcodées */
var(--bg) var(--bg-2) var(--bg-3) var(--bg-card)
var(--border) var(--border-hover)
var(--blue) var(--blue-bright) var(--blue-glow)
var(--green) var(--green-dim)
var(--red) var(--red-dim)
var(--yellow)
var(--text) var(--text-2) var(--text-3)
var(--font-display) var(--font-body) var(--font-mono)
```

---

## Gestion erreurs API

```typescript
// Toujours afficher err.error.message côté frontend
// Jamais "Internal server error" générique
this.aiService.insights().pipe(
  catchError(err => {
    this.errorMessage.set(err.error?.message ?? 'Une erreur est survenue');
    return EMPTY;
  })
)
```

### Suppressions : jamais de `subscribe` sans branche d'erreur

Trois échecs silencieux corrigés à ce jour, tous de la même forme — `subscribe({ next })`
sans `error`, ou un `error` qui ne fait que relâcher un spinner. L'utilisateur clique,
rien ne bouge, il conclut que l'app est cassée (« je rafraîchis la page il est toujours
dessus c'est normal ? », retour Discord). Points de contrôle :

- **Toute mutation a une branche `error` qui écrit un message affiché.** Repli lisible
  si le serveur n'en fournit pas — jamais `undefined` à l'écran.
- **Un `404` sur une suppression vaut succès** : la ligne n'est plus là, c'est
  l'objectif. La compter comme un échec affiche une erreur pour un but atteint et
  laisse à l'écran une ligne qui n'existe plus.
- **`forkJoin` s'arrête à la première erreur** et perd le sort des autres requêtes —
  qui, elles, ont abouti côté serveur. Pour une suppression en lot, encapsuler chaque
  requête (`map` + `catchError` → `{ id, parti }`) puis rendre compte du résultat réel :
  ce qui est parti disparaît, ce qui résiste est nommé. Sinon l'écran ment sur l'état
  du serveur jusqu'au prochain rechargement.

### Ne jamais figer un objet dérivé dans un signal

Une modale qui mémorise l'objet (`signal<DayGroup>`) au lieu de sa **clé** garde un
instantané qui se périme dès que la source change. Constaté sur le journal : la modale
annonçait « 22 trades » alors qu'il en restait 20, et rejouait des ids déjà supprimés.

```typescript
// ✅ la clé dans le signal, l'objet recalculé depuis la source vivante
readonly confirmDeleteDayKey = signal<string | null>(null);
readonly confirmDeleteDay = computed(() => {
  const key = this.confirmDeleteDayKey();
  return key === null ? null : this.tradesByDay().find(d => d.key === key) ?? null;
});
```

Corollaire : un message d'erreur lié à cette modale se nettoie via un `effect` sur la
**clé**, pas à la fermeture — il ne survit alors ni à la fermeture ni au passage sur un
autre élément, et l'écriture du message (clé inchangée) ne le rejoue pas.

Deux pièges de ce passage à la clé, tous deux dans le journal :

- **La fermeture après succès reste explicite.** On pourrait croire que la modale se
  referme d'elle-même puisque le groupe disparaît — c'est vrai d'une suppression, faux
  d'un déplacement : hors filtre par compte, la journée existe toujours après coup.
- **Prévoir le groupe devenu vide** entre l'ouverture et le clic : sans garde, on envoie
  une liste d'ids vide et le back répond un refus incompréhensible.

---

## Blocs verrouillés (teaser + overlay)

Deux approches : le composant partagé `mtc-premium-lock` (simple), ou l'overlay
teaser flouté pour les vues riches. **Le cadenas est une icône Lucide `Lock`**
(ou un SVG inline au tracé Lucide) — plus jamais l'emoji 🔒 (incohérent avec les
autres icônes). L'aperçu derrière l'overlay est un **mock** (jamais la vraie donnée
→ pas de fuite).

```html
<div class="locked-feature">
  <div class="locked-preview" aria-hidden="true">
    <!-- aperçu MOCK flou du contenu -->
  </div>
  <div class="locked-overlay">
    <span class="locked-icon">
      <lucide-icon [img]="LockIcon" [size]="20" /> <!-- ou svg inline tracé Lucide -->
    </span>
    <h3>Titre de la feature</h3>
    <p>Description de la valeur ajoutée</p>
    <button (click)="showPlanModal.set(true)">Débloquer →</button>
  </div>
</div>
```

---

## Environments

```typescript
// environment.production.ts
export const environment = {
  production: true,
  apiUrl: 'https://api.mytradingcoach.app',
  appName: 'MyTradingCoach',
  appUrl: 'https://app.mytradingcoach.app',
  landingUrl: 'https://mytradingcoach.app',
};

// environment.ts  ← config par DÉFAUT en dev (il n'y a PAS d'environment.development.ts)
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3001/api',   // 3001, pas 3000
  wsUrl: 'http://localhost:3001',
  appName: 'MyTradingCoach',
  appUrl: 'http://localhost:4200',
  landingUrl: 'http://localhost:4321',
};
```

Fichiers réellement présents : `environment.ts` (défaut dev), `environment.dev.ts`,
`environment.beta.ts`, `environment.production.ts` — substitués via `fileReplacements`
dans `project.json`. **L'API dev écoute sur 3001** : lancer `PORT=3001 pnpm nx serve
api-mytradingcoach`, sinon le front tape dans le vide. Les helpers e2e prennent la même
valeur par défaut (`E2E_API_URL`).

---

## Source de vérité design

Le miroir statique `app-mytradingcoach.html` a été **retiré** (commit `581875e`) — ne
plus s'y référer ni tenter de le synchroniser. La source de vérité du design c'est :
1. **le composant lui-même** (`*.component.html` / `.ts` inline + `.css`), aligné sur les
   tokens de `styles/theme.css` (« The Terminal » — cf. `.claude/agents/design.md`) ;
2. les **maquettes dédiées** du dépôt (`maquette-*.html`) et le projet Claude Design
   quand ils existent pour la vue concernée.

Règles design non négociables (détail dans `design.md`) : dark only, tokens CSS (jamais
de valeur en dur), chiffres/labels en `--font-mono` + `tabular-nums`, **icônes Lucide**
(jamais d'emoji dans les headers — seuls les émotions trader et watermarks décoratifs
sont tolérés), pas de barre d'accent `::before` sur les cartes de contenu. **Mise en page** : page sur toute
la largeur à droite de la barre latérale (aucun `max-width` de page, grille à colonnes
automatiques), défilement vertical seulement, vérifiée de 360 à 2560 px (règle complète dans
`design.md`).

---

## data-testid obligatoires

```html
<!-- Auth -->
<input data-testid="login-email" />
<input data-testid="login-password" />
<button data-testid="login-submit" />

<!-- Journal -->
<button data-testid="add-trade-btn" />
<div data-testid="trades-list" />
<div data-testid="win-rate" />
<div data-testid="pnl-total" />
<table data-testid="heatmap" />
<div data-testid="locked-overlay" />

<!-- Dashboard V2 — Session Mode (BETA_TESTER + ADMIN) -->
<button data-testid="tab-dashboard" />
<button data-testid="tab-morning" />
<button data-testid="tab-live" />
<div data-testid="session-morning-view" />
<div data-testid="session-live-view" />
<button data-testid="mood-confident" />
<button data-testid="mood-focused" />
<button data-testid="mood-neutral" />
<button data-testid="mood-tired" />
<button data-testid="start-session" />
<button data-testid="close-session" />
<div data-testid="yesterday-recap" />
<div data-testid="today-objectives" />
<div data-testid="eco-calendar" />
<div data-testid="live-feed" />
<div data-testid="quick-trade-form" />
<input data-testid="quick-trade-asset" />
<button data-testid="quick-trade-long" />
<button data-testid="quick-trade-short" />
<button data-testid="quick-trade-submit" />
<div data-testid="trade-close-panel" />
<input data-testid="trade-exit-price" />
<div data-testid="trade-close-type" />
```

---

## « Quel est ce compte ? » — liaison au plan prop firm (#612, 2026-10-18)

`features/accounts/account-plan-wizard` (`mtc-account-plan-wizard`, entrée `accountId`, sortie
`done`) : un choix par écran, firm → taille → phase (si le catalogue en distingue deux) → programme.
Charge lui-même catalogue + `AccountsApi.planHint`, enregistre lui-même (PATCH) et émet le compte :
le parent recharge son store. Pré-sélection via `guessPlan` (`@mtc/shared`) : `found` → « On dirait
un Apex 50K » Oui / Changer · `personal` → « compte perso ? » · `ambiguous` → firm pré-choisie,
écran taille · `none` → firm. Le **programme** n'est jamais deviné. « Compte perso », « Ma firm
n'est pas dans la liste » et « Plus tard » posent `planLinkChoice`. Disclaimer d'estimation en pied.

- Branché **après** `selectThenSync` réussi (historique importé = solde de départ connu) :
  onboarding étape 8 (`tvPlanAccountId`, les autres options masquées, puis étape 9 sur `done`) et
  Mes comptes (modale `plan-wizard-modal`, feuille pleine largeur < 768 px), compte sans plan.
- Champ texte en `[value]` + `(input)` (pas `ngModel`, asynchrone : intestable sans `whenStable`).
- **Rattrapage** (« plan à renseigner » = `needsPlanLink` de `@mtc/shared` : prop firm sans plan ou
  `LATER`, jamais archivé / `PERSONAL` / `UNLISTED`) : bandeau `plan-link-<id>` sur la ligne de Mes
  comptes (bouton « Relier » → même modale, **pas de masquage** : l'ancien bandeau masquable en
  localStorage et limité aux comptes qui collaient à un plan a été retiré) ; Session live : bloc
  `live-prop-firm-plan-cta` **à la place des 3 jauges**, hauteur fixe `3 × 61 px + 2 écarts` (jauge mesurée au banc local) (la
  colonne ne saute pas quand le plan est relié), modale au palier 1000. Pas de modale bloquante, pas d'email.

## Connexion broker par compte — pattern (PROMPT-208, Tradovate)

Réutilisable pour tout broker synchronisé par API (cf. `nestjs.md` pour le back).

- **Un compte = une connexion.** L'état vit dans `TradovateStore` (root) : `connections`,
  `byAccount` (Map accountId → connexion), et **par compte** `busy` (`sync` | `select` |
  `disconnect`) et `feedback` (lignes + erreur). Deux comptes (Apex + Lucid) ne se bloquent
  jamais l'un l'autre. Le wizard et « Mes comptes » partagent ce store.
- **Écran de réassurance AVANT de quitter l'app** (`mtc-tradovate-connect-modal`, palier
  z-index 1000 pour passer au-dessus de l'overlay d'onboarding) : compte cible, 3 étapes,
  encadré lecture seule (icône Lucide `Lock`, pas l'emoji). Rien n'est créé avant le retour
  de Tradovate : fermer l'onglet en cours de route ne laisse aucun demi-état.
- **Le cookie de `state` exige `withCredentials`** sur l'appel `authorize` (l'intercepteur
  le pose déjà partout ; `TradovateApi.authorize` le redemande explicitement).
- **Retour OAuth** : tout ce qui se lit et s'affiche est dans
  `core/utils/tradovate-return.util.ts` (pur, testé) : `parseTradovateReturn`,
  `tradovateErrorMessage`, `tradesLine`, `feesLine`, `syncResultLines`, `relativeTime`,
  `excludedAccountsMessage` (comptes du login écartés car reliés à un autre compte MTC).
  Sélecteur `mtc-tradovate-account-picker` : compte unique présélectionné et texte « rien n'est
  importé avant ta confirmation » ; plusieurs comptes → aucun présélectionné.
  - `from=wizard` → lu par l'**onboarding** dans `window.location.search`, APRÈS
    `restoreProgress()` : réussite → étape 9 avec le récap (classe `ob-import-recap`, comme le
    CSV) ; échec → étape 8 + message non bloquant (« tu peux réessayer ou importer un CSV ») ;
    `select_account` (toute première connexion, même à compte unique) → sélecteur à l'étape 8,
    avec `excludedAccountsMessage` si `excluded > 0`. **Jamais l'étape 1**, même si le localStorage a
    disparu.
  - sinon → lu par « Mes comptes » (`router.routerState.snapshot.root.queryParams`).
  - Dans les deux cas, paramètres retirés aussitôt : `router.navigate([], { queryParams:
    {…: null}, queryParamsHandling: 'merge', replaceUrl: true })` — commandes vides = même
    chemin, et un rechargement ne rejoue pas le message.
- **Après une synchro qui crée des trades** : `SelectedAccountStore.load()` +
  `TradesStore.reset()`, sinon dashboard et métriques restent sur l'ancien cache.
- **Déconnexion** : confirmation en ligne (pas de `confirm()` natif), `404` = déjà
  déconnecté = succès. Le bouton reste rendu **pendant le choix du compte**
  (`needsAccountSelection`) : c'est la seule sortie après un mauvais login Tradovate.
  Si `brokerTradesCount > 0`, la confirmation affiche le nombre puis deux choix
  (garder = défaut, en premier · supprimer les seuls trades importés, `?deleteTrades=true`).
  `tradesDeleted: null` = connexion coupée mais suppression échouée → toast d'avertissement
  qui renvoie vers le journal, jamais de rollback de la déconnexion.
- **Synchro = option principale, CSV = repli (PROMPT-211).** Dans `csv-import`, source
  « Tradovate » hors onboarding (`allowFeesFile()`) → encart `import-tradovate-reco` d'abord
  (connecter → `mtc-tradovate-connect-modal` origin `settings` pour le compte choisi ; déjà
  connecté → `TradovateStore.sync`, résultat émis par `imported` comme un import), puis lien
  discret « ou importer un fichier CSV Tradovate » (`tvCsvOpen`) qui déroule les deux fichiers.
  Chaque ouverture repart sur la reco. Onboarding (`allowFeesFile=false`) et « Autre broker »
  inchangés. Wizard étape 8 : carte Tradovate en tête pleine largeur (`choice-featured`, accent
  `--nt`), CSV / manuel / zéro au second plan. Verrouillé par `csv-import-tradovate-*.spec.ts`.
- **Temps réel (PROMPT-210 live)** : `TradovateLiveSocketService` (root, socket.io
  `/tradovate-live`). Connecté par le **shell** (`SidebarComponent`, effet
  `isAuthenticated && !isDemo`), pas par l'écran Session live : app ouverte = connecté, logout /
  onglet fermé = coupé. `auth` est une FONCTION (jeton relu à chaque reconnexion) ; rejet
  serveur (`io server disconnect`) → nouvel essai espacé 2 s → 60 s. Échec = silence, le
  bouton « Synchroniser » reste le filet. `tradovate:trades` → toast, `SelectedAccountStore` +
  `TradovateStore` rechargés, `SessionStore.refreshLive()` si session ouverte (Live feed), puis
  `imported$` : journal et dashboard s'y abonnent pour se recharger.
- **Clause 2.ii NinjaTrader** : aucun autre broker nommé dans ces écrans et messages
  (verrouillé par `tradovate-return.util.spec.ts`). Aucun bouton ne suggère un ordre.
- **Tests sur le VRAI template** : `import TEMPLATE from './x.component.html?raw'` puis
  `overrideComponent({ set: { template: TEMPLATE, imports: [pipes nécessaires], schemas:
  [NO_ERRORS_SCHEMA] } })`. **Pas `node:fs`** dans un spec jsdom : sous l'exécuteur nx
  (`pnpm nx test`, celui de la CI), `node:path` est externalisé et le fichier entier échoue
  sans message, alors que `vitest run` direct passe. Les entrées signal (`input()`) ne
  s'alimentent pas en JIT : remplacer `cmp.accountId = signal(…)` avant le premier
  `detectChanges()`.

---

## Payouts d'un compte funded (feature payouts, partie 1, 2026-10-21)

`features/accounts/account-payouts` (`mtc-account-payouts`, entrées `accountId`, `currency`, `connected`,
sortie `changed`) : au dépli d'un compte FUNDED dans Mes comptes (la ligne a alors `has-detail`). Liste
des payouts (`AccountsApi.listPayouts`) : « saisi » (supprimable, `ConfirmService`, 404 = succès) ou
« détecté chez le broker ». Compte sans connexion : formulaire date (max aujourd'hui) + montant →
`addPayout` ; compte connecté : pas de saisie (l'API répondrait 409). `changed` → `store.load()` : solde,
marge et cycle repartent du serveur. Note du cycle : `cycleSource === 'manual'` → « saisi dans la liste
des payouts ». En spec (JIT), remplacer les signaux d'`input()` sur l'instance (`setInput` échoue).
Au moins un payout (saisi ou détecté) : note `payouts-floor-lock-note` (« Le plancher gelé après un
payout n'est pas encore pris en compte dans l'estimation. Vérifie chez ta firm. ») tant que la règle
« plancher gelé au premier payout » n'est pas modélisée au catalogue. À retirer quand elle le sera.

## Compte perdu (#681, 2026-10-21) — statistiques sans les comptes échoués et archivés

Miroir front de la règle API (`nestjs.md`, « Compte perdu ») : **aucun chiffre « tous les comptes »
sans filtre de statut**. `FAILED` et `ARCHIVED` sont exclus par défaut, `PASSED` compté, un compte
choisi dans le sélecteur s'affiche toujours (même échoué ou archivé).

**Règle partagée : `core/utils/account-status.util.ts`** (`countsInAggregate`, `isInactiveStatus`,
`statusLabel`, `statusBadgeClass`, `excludedAccountsLine`). Jamais de `status !== 'ARCHIVED'` recopié
dans un composant.

**`SelectedAccountStore`** porte l'état :
- `includeInactive` (interrupteur, **non persisté**, remis à faux par `reset()`), `setIncludeInactive()` ;
- `inactiveIncluded` (l'interrupteur ne joue qu'en « Tous les comptes ») ;
- `aggregateAccounts` : comptes qui entrent dans le capital et les soldes agrégés ;
- `excludedAccounts` `{ failed, archived }` pour la ligne « n comptes exclus des chiffres » ;
- `statsParams()` / `statsQuery()` : `accountId` d'un compte précis, sinon `includeInactive=true`
  quand l'interrupteur est actif, sinon rien.
- Un compte archivé ou échoué **reste sélectionnable** : `load()` ne renvoie sur « Tous » que si le
  compte a disparu.

Toute ressource de statistiques passe par `statsQuery()` / `statsParams()` (dashboard, analytics,
courbe journalière, calendrier). Le capital agrégé lit `aggregateAccounts()`
(`viewBalance(…, includeInactive)` en 4e paramètre). Les URL ne changent pas quand un compte change
de statut : dashboard, analytics et journal ont un `effect` sur `excludedAccounts()` qui recharge
les chiffres (jamais au premier passage).

**Écrans** (maquette `maquettes/mockup-compte-perdu.html`) :
- `features/accounts/lost-account/floor-reached-banner` (`mtc-floor-reached-banner`) : un bandeau
  par compte `floorReached`, en haut du dashboard et de Mes comptes. « Pas maintenant » masque CE
  compte 24 h (`floor-snooze.util.ts`, clé `mtc.floorSnooze`). Hôte en `is-empty` (display none)
  sans bandeau.
- `core/services/lost-account-flow.service.ts` (`LostAccountFlowService`, root) : feuille de choix et
  feuille « nouvelle tentative » (états par **id**). **Rien n'est enregistré avant « Confirmer »**.
  Archiver et « garder comme échoué » = `PATCH status` (**jamais `DELETE /accounts/:id`**, qui
  supprimerait un compte sans trade) ; supprimer = `ConfirmService` (danger, rappel compte MTC et
  abonnement) puis `DELETE /accounts/:id/permanent` ; un 404 vaut succès ; puis `store.load()` et
  `tradesStore.reset()`. Ouvert depuis l'alerte live, il charge la liste des comptes si besoin.
- `features/accounts/lost-account/lost-account-sheets` (`mtc-lost-account-sheets`) : monté UNE fois
  dans la coque (`sidebar.component.html`). Feuille en bas d'écran < 768 px, boîte centrée au-delà,
  `mtcDialog`, vrais boutons radio (« Archiver » coché à chaque ouverture).
- `shared/components/inactive-accounts-toggle` (`mtc-inactive-accounts-toggle`) : ligne + interrupteur
  (`role="switch"`), sur le dashboard, les statistiques et le journal ; visible seulement en « Tous les
  comptes » s'il existe un compte échoué ou archivé.
- Alerte live : `PropAlertsService` ajoute l'action « Marquer comme échoué » au toast
  `drawdown` / `breached` (et à lui seul). `ToastOptions.action` / `ToastService.runAction()` : le
  bouton `.toast-action` est exclu de la capture du pointeur (glisser pour fermer), comme la croix.
- Mes comptes : badge `.status-badge` (Actif, Validé, Échoué, Archivé), liseré rouge d'un compte échoué
  (`accentVar`, car le style en ligne `--ac` bat une classe), sous-ligne « Hors statistiques » avec
  « Nouvelle tentative » et « Archiver » (44 px), archivés dans un `<details>` replié. La ligne est un
  `<ng-template #acctRow>` rendu par `NgTemplateOutlet` (liste principale + section archivée).
- Sélecteur de compte : groupe « Hors statistiques » avec badge ; solde de « Tous » = `aggregateAccounts`.
  Compte échoué ou archivé choisi : ligne discrète sous le sélecteur (`selected-inactive-note`,
  « Ce compte est échoué : il ne compte pas dans « Tous les comptes ». », ton des notes, sans couleur d'alerte).
- **Période par défaut d'un compte échoué ou archivé** (`core/utils/inactive-period.util.ts`) : ses
  trades sont souvent plus vieux que « 1 mois ». Tableau de bord et Statistiques passent sur « Tout »
  quand on le choisit ; le calendrier des Statistiques s'ouvre sur le mois de son dernier trade
  (`TradesApi.getAll({ accountId, limit: '1' })`). Retour sur un compte actif : période et mois d'avant
  reviennent. Un choix de l'utilisateur (`setPeriod`, `selectPeriod`, `onMonthChange`) prime et
  désarme le retour automatique. Comptes actifs : inchangés.
- **Connexion Tradovate : comptes ACTIVE seulement** (`canConnect` dans Mes comptes, « Connecter » et
  « Reconnecter » ; l'import CSV ne cible déjà que `activeAccounts()`). Une connexion DÉJÀ établie sur
  un compte qui devient échoué, validé ou archivé n'est pas touchée : elle reste `CONNECTED` et la
  synchro continue côté API (décision en attente, issue #683).
- Journal : la liste garde tout, badge sur les trades d'un compte échoué ou archivé (la cellule de
  l'actif passe à la ligne au lieu de couper le badge). Les KPIs utilisent `statsFilters`
  (`includeInactive` en plus) ; la liste garde `journalFilters` (l'interrupteur ne la recharge pas).
  Compteur des filtres : « n trades dans les chiffres » quand des comptes sont exclus.

⚠️ `src/styles/global.css` n'est importé nulle part : un style global va dans `src/styles.css`
(c'est là qu'est `.status-badge`).

## Autopsie d'un compte grillé (#669, 2026-10-23)

Maquette `maquettes/mockup-autopsie.html` (fait foi). Route **paresseuse**
`/accounts/:accountId/autopsie/:incidentId` → `features/accounts/autopsy/account-autopsy.component`.
- Mise en forme pure dans `autopsy.util.ts` (en-tête, KPI, lignes, courbe SVG `distanceChart`,
  `frenchSpacing` : espace insécable devant `: ; ! ?` des constats et de l'IA). Fixture de test :
  `autopsy.fixture.ts` (jamais importer une fixture depuis un `*.spec.ts` : ses tests seraient rejoués).
- Contrat : `libs/shared/src/contracts/incident.ts`. Client : `AccountsApi.incidents / incident /
  incidentAnalysis / dismissIncident`.
- Gratuit : chronologie et constats ; carte IA verrouillée (« Essayer Premium · 1 mois offert » selon
  `trialAvailable`). Premium, `ai.status = 'pending'` : UN appel à `…/analysis` à l'ouverture.
  Démo : texte préenregistré, badge « Exemple » + note « sans appel à l'IA ».
- « Repartir sur une nouvelle tentative » seulement sur un compte FAILED (`LostAccountFlowService.openRetry`) ;
  Libellé (B2) : « Ce n'est pas un échec » seulement si `canReactivate` ; sinon (autopsie non confirmée,
  échec marqué à la main) « Retirer cette autopsie », note « Retirer l'autopsie ne change pas le statut du
  compte. ». Même confirmation dans les deux cas.
  « Ce n'est pas un échec » → **`ConfirmService.ask` d'abord** (retrait définitif, réactivation annoncée si
  `canReactivate`), puis `dismissIncident`, toast, `store.load()`, retour à `/accounts`.
- Feuille de choix (« Garder comme échoué » / « Archiver ») : `update(id, { status, confirmIncident: true })`.
  Le formulaire d'édition n'envoie JAMAIS `confirmIncident` (son archivage ne confirme aucune autopsie).
- 404 au chargement → bloc `autopsy-not-found` « Cette autopsie n'existe pas ou n'est plus disponible »
  (même message retirée / inexistante / autre compte), lien vers Mes comptes ; autre erreur → `mtc-error-state`.
- Couleurs (revue #712) : action principale sur `--primary` (aussi `lost-btn.pri`, `la-btn.pri`,
  `.toast-action`), courbe et pastilles des constats en neutre (`--text-2` / `--bg-3`), **aucun cyan**
  sur la page (réservé à l'IA et au temps réel). Rouge = seul trade qui franchit la limite (point
  `dot-cross` et ligne `li.last`), jamais un trade gagnant resté sous une limite déjà franchie. Montant
  des KPI : `white-space: nowrap` + `clamp(13px, 4.2cqi, 18px)`. Courbe : seule la première alerte porte
  un libellé (ancré à gauche s'il déborde) ; une seule heure sous l'axe si début = fin.
- Espaces insécables : `frenchSpacing` aussi sur les titres et méta de la chronologie ; `&nbsp;` dans le
  template ; le test de la page refuse toute espace simple devant `: ; ! ?`.
- Page bornée à 1180 px (le SVG s'étire avec la colonne) ; deux tracés (358 / 560) selon la largeur
  du conteneur ; une colonne puis deux à partir de 760 px (`@container`).
- Entrées : Mes comptes (« Voir l'autopsie » si `openIncidentId`, compte FAILED ou ARCHIVED ; sur sa
  ligne en mobile) et bouton du toast après « Confirmer » de la feuille de choix (cherche l'autopsie
  au clic, sinon toast info).

## Feedback utilisateur : toast · inline · bloc persistant (PROMPT-210)

> Toast qui porte un bouton (`opts.action`) : durée par défaut ≥ `TOAST_ACTION_MIN_DURATION` (10 s),
> le temps de lire puis d'agir ; une `duration` explicite reste respectée (revue #712).


**Un seul système de toasts** : `core/services/toast.service.ts` (`ToastService`, root, signals)
et **un seul conteneur** `mtc-toasts` monté dans `app.ts` (`<router-outlet /><mtc-toasts />`,
hors routeur : il survit aux navigations). Ne JAMAIS recréer un toast local dans un composant
(l'ancien `feedbackToast` de session-live a été retiré).

```typescript
private readonly toast = inject(ToastService);
this.toast.success('Trade supprimé');
this.toast.error(apiErrorMessage(err, "Ce trade n'a pas pu être supprimé."));
this.toast.warning('…', { duration: null }); // null = fermeture manuelle uniquement
```

- Durées : success/info 4 s · warning/error 7 s. Pause au survol ET au focus. Croix sur chaque
  toast. 3 visibles max, les suivants en file (le minuteur ne part qu'à l'affichage). Même
  type + même message déjà affiché → relancé, pas empilé (double-clic).
- A11y : succès/info/warning `role="status"` + `aria-live="polite"` ; erreur `role="alert"` +
  `aria-live="assertive"`. `prefers-reduced-motion` respecté.
- Comportement (usuel, PROMPT-210 bis) : chaque toast vit dans une **case repliable**
  (`.toast-slot`, `grid-template-rows` 0fr ↔ 1fr) : la pile se décale en douceur à l'entrée
  comme à la sortie, sans saut. **Entrée** : glisse depuis le bord droit (0,28 s, léger
  ressort ; depuis le bas en mobile). **Barre de compte à rebours EN HAUT** (`.toast-bar`,
  `scaleX` 1 → 0 sur la durée réelle, figée via `ToastService.isPaused` = même état que le
  minuteur ; recréée quand le même message est relancé grâce à `Toast.version` ; absente si
  `duration: null`). **Sortie** : `[animate.leave]="leaveClass(id)"` (API native Angular
  ≥ 20.2, pas `@angular/animations`) — le toast repart vers le bord puis la case se replie ;
  Angular retire la case à la fin. **Glisser pour fermer** (souris ou doigt,
  `touch-action: pan-y`) : au-delà de max(80 px, 35 % de la largeur) le toast part du côté
  du geste, sinon il revient ; minuteur suspendu pendant le geste. **Mouvement réduit** :
  ni glissement ni repli animé, barre par paliers (`steps`). jsdom ne joue pas les
  animations : `toasts-animation.spec.ts` verrouille les sources (template + CSS lus avec
  `node:fs` en `@vitest-environment node` — un `.css?raw` est VIDE sous vitest).
- Position : bas-droite desktop ; mobile centré en bas **au-dessus du FAB « + »** (92 px) — le
  haut est pris par le burger. z-index 10000 (au-dessus des modales 1000).
- Message d'erreur API : **toujours** `apiErrorMessage(err, repli)` (`core/utils/api-error.ts`) —
  message du back s'il existe (tableaux ValidationPipe joints), sinon repli lisible, jamais
  `undefined`.

**Règle de choix — ne pas tout convertir :**

| Nature | Forme | Exemples |
|---|---|---|
| « Quelque chose vient de se passer, tu peux continuer » | **toast** | Lien copié · Trade enregistré/supprimé/déplacé · échec d'une action ponctuelle · retour OAuth Tradovate · « Import terminé » |
| « Corrige ça ici » | **inline, à côté du champ** | validation de formulaire (trade-form, auth), erreur API rendue dans un formulaire encore ouvert (`[apiError]` de trade-form) |
| « Information à consulter » | **bloc persistant** | récap d'import CSV, frais non rapprochés · P&L brut, position ouverte, avertissements Tradovate de la carte compte |
| État de la page | **pas un toast** | chargement, vide, paywall, « Impossible de charger ton parrainage », carte « Demande envoyée », succès mot de passe oublié / réinitialisé (le bloc REMPLACE le formulaire) |
| Échec partiel actionnable dans une modale ouverte | **inline dans la modale** | suppression d'une journée : trades restants + « Réessayer sur N trades » |

**Plus d'échec muet** : toute mutation déclenchée par l'utilisateur a une branche `error` qui
affiche un toast (ou un message inline si c'est une validation). Les chargements de fond et
rafraîchissements périodiques restent silencieux (état de page). Repérage utilisé en PROMPT-210 :
chercher les `subscribe(` sans `error`, ou dont l'`error` ne fait que relâcher un spinner.

**Tests** : `TestBed.inject(ToastService).visible()` donne `{ type, message }` des toasts
affichés (service réel, pas besoin de le mocker). Pour un composant qui monte `mtc-toasts`
(`app.spec.ts`) : `ɵresolveComponentResources` avec un résolveur vide dans `beforeAll`, puis
`overrideComponent(ToastsComponent, …)` AVANT `compileComponents()`.


**Téléphone (≤ 768 px, 2026-10-18)** : pile **en haut**, sous la barre du burger / du bandeau démo
(`top: safe-area + 60px`), **un seul toast visible** (`ToastService.setMaxVisible(1)` posé par
`mtc-toasts` via `matchMedia`), les autres en file (« +N »). Avant : jusqu'à 3 toasts à 92 px du bas,
en plein contenu. Le refus « mode démo » (403 `DemoReadOnlyGuard`) ne fait **jamais** de toast :
`demoInterceptor` ouvre déjà l'invite « Crée ton compte » (`ToastService.show` l'ignore).
## Librairie partagée `@mtc/shared` (2026-09-13)

- Import `from '@mtc/shared'` (stats de trades, valeurs tarifaires) — source unique avec l'API.
  Détails et règles de la lib : `nestjs.md` § « Librairie partagée ».
- Branchement (voir `nestjs.md` § « Librairie partagée » pour la liste complète) : l'alias
  `@mtc/shared` est déclaré **une seule fois**, dans `tsconfig.base.json` (hérité par l'app et
  l'admin, et lu par Nx pour le graphe : une modif de la lib rebuild et redéploie les apps).
  Ne PAS redéclarer `paths` dans le tsconfig d'une app : cela écrase celui de la base.
  Vitest ne lit pas les `paths` : `resolve.alias` dans `apps/app-mytradingcoach/vitest.config.mts`.
  La lib reste dans l'`include` de `tsconfig.spec.json` de l'app (projet `composite`).
- `core/constants/pricing.const.ts` garde ses exports (`PRICING`, `ACCOUNT_LIMITS`,
  `yearlyPerMonth`) mais lit ses VALEURS dans `@mtc/shared` : un prix ne se change plus que dans
  `libs/shared/src/pricing.ts` (+ la landing `Pricing.astro`, non branchée à la lib).

## Couche HTTP, erreurs et templates (étape 4 de l'audit, 2026-09-13)

- **Aucun `HttpClient` dans un composant** : tout appel passe par `core/api/*.api.ts`
  (`AiApi` créé pour cooldown / insights / chat ; `TradesApi.importCsv`, `DebriefApi.exportPdf`,
  `AnalyticsApi.getDailyEquityCurve` ajoutés). Un type de réponse propre à un écran reste dans
  l'écran : la méthode d'API le reçoit en générique (`importCsv<ImportResult>`,
  `insights<InsightsResponse>`). `trades.store` passe aussi par `TradesApi.getAll`, typé sur la
  vraie page de l'API (`TradesPage` : `data` + `nextCursor` + `hasNextPage`, pagination par
  curseur ; l'ancien `PaginatedTrades` à `meta` n'existait pas côté back). Un seul type `Trade`
  (celui de `trades.api.ts`), ré-exporté par le store. Dans un spec, la query d'une requête
  construite avec `HttpParams` se lit dans `request.urlWithParams`, pas `request.url`.
- **Un seul helper d'erreur** : `apiErrorMessage(err, repli)` vit dans `@mtc/shared` (sans
  Angular), ré-exporté par `core/utils/api-error.ts` ; l'admin l'importe directement. Plus de
  `err.error?.message ?? …` en ligne ni de `tradovateErrorText`.
- **Templates de plus de ~150 lignes → `templateUrl` (.html)** : 12 composants migrés
  (session-live, dashboard, csv-import, session-morning, session-day, sidebar, sessions,
  debrief, ai-insights, register ; admin : user-detail, emails). Un spec qui lisait le template
  dans le `.ts` lit maintenant `.ts` + `.html` (cf. `csv-import-*.spec.ts`).
- Mock de `TradesApi` dans un spec qui intercepte le HTTP : lui donner une méthode qui émet la
  vraie requête (`TestBed.inject(HttpClient).delete(...)`), pour garder `HttpTestingController`.

## Découpage dashboard / session-live (audit, 2026-09-13)

- **Dashboard** : le parent garde l'état (période, compte, `httpResource`), le chrome des
  panneaux (`.mtc-panel` + en-tête) et les **états vides** ; chaque viz est un composant de
  `panels/` qui ne reçoit que des données prêtes (`input`). Les calculs vivent dans
  `dashboard-charts.util.ts` (fonctions pures, testées dans `dashboard-charts.util.spec.ts`).
  Les specs du dashboard lisent des membres du parent (`summary`, `baseCapital`,
  `currentCapital`, `accountReallyEmpty`, `dashboardPeriod`, `setPeriod`, `plGranularity`,
  `plTitle`, `periodRange`, `showCsvImport`) : ne pas les déplacer dans un panneau.
- **Session live** (v3) : le parent garde le cadre (CTA sans session, grille `.lv-grid`, feuille
  Contexte). La **connexion du WebSocket éco** est dans `SessionStore` depuis SCA-B4 (voir
  « Polling »). Bandeau, prochaine annonce, trade en cours, suivi du compte, trades clôturés, trade
  rapide et news (ticker + modale) sont dans `session-live/components/`.
- **CSS encapsulée** : le style d'une viz vit dans SON composant (un sélecteur du parent ne
  descend pas dans l'enfant). L'hôte d'un panneau de grille est un flex colonne
  (`:host { display:flex; flex-direction:column; min-width:0; min-height:0 }`) et le bloc
  interne s'étire (`flex:1`) : c'est ce qui reproduit l'étirement de la grille d'avant. Les
  `@container` fonctionnent dans les composants enfants (conteneur résolu dans le DOM).
  Une règle partagée par deux panneaux (`.pulse-dot`, `.col-title`) est dupliquée dans chacun,
  keyframes comprises (Angular préfixe les `@keyframes` d'un composant).
- Vérification d'un tel découpage : empreinte de mise en page (tag, classes, position, taille
  de chaque élément hors hôtes `mtc-*` et icônes) avant / après sur beta avec le compte démo,
  plus un script qui vérifie que chaque classe utilisée par un template a sa règle dans le CSS
  du même composant.

## Migration Angular 22 / Nx 23 / TypeScript 6.0 (étape 5 de l'audit, 2026-09-13)

- Faite par `nx migrate latest` + `--run-migrations` (Angular 22.1.6, CLI/build 22.1.8, Nx 23.2.1,
  TypeScript 6.0.3 — Angular 22 exige TS `>=6.0 <6.1`, donc **pas TypeScript 7**).
- **Migration `safe-optional-chaining` volontairement NON appliquée** : en Angular 22, `a?.b` dans un
  template suit la sémantique JS (`undefined`, plus `null`). La migration aurait entouré les 76 `?.`
  de `$safeNavigationMigration(…)` pour garder `null`. Aucun n'était comparé à `null` et l'affichage
  est identique (`??` traite les deux pareil). Règle désormais : ne pas écrire `=== null` sur le
  résultat d'un `?.` dans un template ; une entrée typée `T | null` qui reçoit un `?.` le verra au
  build (strictTemplates).
- `strict-safe-navigation-narrow` : les diagnostics `nullishCoalescingNotNullable` et
  `optionalChainNotNullable` sont mis en `suppress` dans les `tsconfig.app.json`.
- TypeScript 6 : `ignoreDeprecations: "6.0"` et, dans `tsconfig.base.json`, `types: ["*"]` +
  `noUncheckedSideEffectImports: false` pour garder le comportement de TS 5 (TS 6 change ces défauts).
  Chaque tsconfig a un `rootDir` explicite : `../..` pour l'app, l'admin et leurs specs (ils incluent
  `libs/shared`), sinon `@mtc/shared` sort de la racine et TypeScript refuse le fichier.

## Contrat front ↔ API (`libs/shared/src/contracts`, audit du 27/09/2026)

- **Source unique des formes JSON échangées** : enums (copie des enums Prisma), trades, sessions,
  débrief, calendrier éco, fiche utilisateur admin, stats VPS. Import : `from '@mtc/shared'`.
- Les dates y sont des `string` ISO (ce que le front reçoit). Côté API, les DTO de requête
  `implements` le contrat (`CreateTradeDto implements CreateTradeRequest`) : un champ ajouté d'un
  seul côté casse la compilation.
- Enums : `EmotionState.FOCUSED` (valeur) / `EmotionState` (type). Le test API
  `common/contracts-sync.spec.ts` compare chaque enum à Prisma : après une migration qui touche un
  enum, mettre à jour `contracts/enums.ts`.
- Jamais de nouvelle interface d'échange recopiée dans `core/api/*.api.ts` : l'ajouter au contrat,
  puis la ré-exporter (`export type { X }`) si des importeurs existants passent par l'API front.
- Aussi partagés : `todayParis` / `parisDayRange` (dates Paris), `normalizeEventKey` / `eventKey`,
  `renderEmailMarkdown` (rendu des campagnes côté API).
- Aperçu des campagnes (admin `/emails`) : **toujours** le HTML renvoyé par
  `POST /admin/campaigns/:type/preview` (le vrai template envoyé), jamais un rendu reconstruit côté
  front. Objet/contenu d'une annonce → nouvel appel après 400 ms de pause (`switchMap`).
- Campagnes `requiresTest` (`founder_launch`) : bouton « Envoyer un test à {testEmail} » (adresse
  donnée par l'API, jamais saisie) ; « Envoyer à N inscrits » désactivé tant que le contenu actuel
  n'est pas testé (`testedCurrent`, revérifié par le serveur), puis confirmation « Envoyer à N
  inscrits ? ». Pas de case « force » pour ces campagnes. Ciblés avec / sans consentement affichés.

## Libs front partagées (`libs/front/*`, audit du 27/09/2026)

| Lib | Import | Contenu |
|---|---|---|
| `libs/front/ui` | `@mtc/front-ui` | `foundations.css` (échelles, focus clavier, mouvement réduit, `.sr-only`), `ConfirmService` + `<mtc-confirm-dialog>`, `<mtc-error-state>`, directives `mtcDialog` et `mtcScrollMemory` |
| `libs/front/auth` | `@mtc/front-auth` | `jwtRefreshInterceptor` + jeton `AUTH_TOKEN_SOURCE` |

- **Jamais `window.confirm()`** : `await inject(ConfirmService).ask({ title, message, danger })`.
  Le dialogue est monté une fois dans la racine (app et admin).
- **Toute modale** porte `role="dialog" aria-modal="true" mtcDialog (mtcDialogClose)="fermer()"` sur
  la boîte (pas sur le fond) : focus envoyé dedans, Tab piégé, Échap ferme, focus rendu à la
  fermeture. Titre relié par `aria-labelledby`. Ne pas recoder ce comportement à la main.
- **Routeur** : `withInMemoryScrolling` (app et admin) + préchargement : admin `PreloadAllModules` ;
  **app `AuthenticatedPreloading`** (`core/auth/authenticated-preloading.ts`, oct. 2026) : rien pour un
  visiteur anonyme, et pour un connecté seulement une fois le navigateur inactif (`whenIdle`,
  `requestIdleCallback`, repli 1,5 s sur Safari). Avant, `PreloadAllModules` faisait télécharger 35
  chunks (270 Kio) du tableau de bord à un visiteur de /register, en concurrence avec le formulaire.
  Le shell connecté défile dans un conteneur (`<main>` / `.content`), pas la fenêtre :
  `mtcScrollMemory` sur ce conteneur remet en haut à chaque page et restaure la position au bouton
  « Précédent ».
- **`/register` sans import paresseux** (`component: RegisterComponent` dans `app.routes.ts`) : page
  d'arrivée des pubs. L'import paresseux ajoutait 2 allers-retours en cascade (chunk de la page, puis
  ses dépendances), ≈ 1,3 s en 4G lente. Coût : +12,8 Ko gz au bundle initial (≈ 474 kB bruts, au-dessus
  de l'avertissement 450 kB, sous le budget bloquant 500 kB). `/login` reste paresseux : le passer en
  direct ne coûterait que +0,6 Ko gz mais 9 kB bruts de marge sur le budget. Ce qui est importé par
  l'inscription arrive au démarrage : **pas de `@lucide/angular`** dedans (œil du mot de passe :
  `mtc-eye-icon`, SVG en ligne, partagé avec la connexion).
- **Mise en page de `/register` et `/login`** (oct. 2026, maquette `maquettes/maquette-register-split.html`) :
  `features/auth/auth-layout/`. `mtc-auth-layout` porte la page ; la page projette le contenu de la
  carte (titres, Google, formulaire), le layout ajoute le logo (< 1024 px seulement) et la ligne de
  confiance en bas de carte (« Lecture seule, aucun ordre passé · Hébergé en France » puis
  « Référencé dans l'écosystème NinjaTrader », texte seul, sans lien). Styles communs de la carte :
  `auth-form.css` (dans les `styleUrls` des deux pages). < 1024 px : carte seule (en haut sur
  téléphone, centrée de 600 à 1023 px). ≥ 1024 px : deux colonnes, présentation à gauche, formulaire
  sur `--bg-2` ; version compacte jusqu'à 1279 px.
  - **Colonne de présentation `mtc-auth-pitch`** (+ aperçu `mtc-auth-preview`, statique, données de
    démonstration, aucun appel API) : importée à la demande seulement quand `(min-width: 1024px)`
    est vraie (jamais sur téléphone), par `import('../login.component')` : `login.component.ts`
    réexporte `AuthPitchComponent` pour que la colonne voyage dans le morceau déjà paresseux de
    `/login`. Un morceau à part (ou `@defer`) scindait le chunk partagé d'Angular : +2,7 kB au bundle
    initial (488,4 kB sur 500 depuis #692, oct. 2026). Ne pas importer la colonne en statique.
  - Points : `SIGNUP_PITCH_POINTS` (`@mtc/shared`, module `signup-pitch.ts` à part pour ne pas
    entrer dans le bundle initial avec `PLAN_BENEFITS`) ; nombre de firms `PROP_FIRM_COUNT`, tenu égal
    à `PROP_FIRM_CATALOG_FILES.length` par un spec (le catalogue fait 1,8 Mo de JSON).
  - Mot de passe et confirmation côte à côte via `@container auth-card (min-width: 300px)` (= carte de
    340 px). Bouton « Explorer la démo, sans compte » (`routerLink="/demo"`, `data-testid="register-demo"`)
    seulement dans le parcours gratuit (ni `offerFlow`, ni Premium).
  - `/forgot-password`, `/reset-password` et la finalisation Google gardent l'ancien gabarit carte
    seule (`auth-layout/card-page.css`, `card-page-signup.css`), à migrer si besoin.
- **Écran de chargement** (`#mtc-boot`, `index.html`) : logo et « Chargement… » statiques, style
  intégré (tokens de `theme.css` avec valeurs de repli), visibles dès le HTML. Texte en police
  monospace **système** : JetBrains Mono y ferait télécharger une police en concurrence avec le JS. Retiré par `App`
  (`removeBootScreen`) après le rendu de la PREMIÈRE page (fin de navigation + `afterNextRender`), pas
  au démarrage d'Angular, sinon une page paresseuse laisserait un écran vide. Jamais d'écran vide.
- **Bundle initial < 500 kB (budget bloquant)** : `@lucide/angular` est un seul module ; si un
  composant chargé au démarrage (racine, toasts, dialogues globaux, **inscription**) l'importe, TOUTES
  les icônes de l'app partent dans le bundle initial (+226 kB). Au démarrage : SVG en ligne (cf. `toasts`,
  `mtc-eye-icon`).
- **Stores d'un utilisateur vidés au logout par `UserScopedReset`** (`core/auth/user-scoped-reset.ts`,
  #692) : chaque store s'inscrit dans son constructeur (`inject(UserScopedReset).register(() =>
  this.reset())`), `AuthService.logout()` appelle `resetAll()`. **`AuthService` (chargé au démarrage)
  n'importe aucun store ni API métier** : avant, il injectait `SelectedAccountStore`, `TradesStore` et
  `SetupsStore`, qui partaient au démarrage avec leurs API (−9,4 kB, 497,8 → 488,4 kB). Nouveau store
  propre à l'utilisateur → s'inscrire là, pas l'injecter dans `AuthService`. Reste au démarrage ~4,5 kB
  de `@mtc/shared` (règles prop firm, stats) via un morceau partagé d'esbuild, sans import direct.
- Dans les libs, sorties en `@Output() … = new EventEmitter()` : leurs tests tournent en JIT, qui
  ne voit pas `output()`.
- **Toute donnée chargée affiche son échec** : `@if (loadError()) { <mtc-error-state (retry)="reload()" /> }`
  avec `loadError = computed(() => !!resource.error())` (Dashboard, Analytics, Scoring en exemple).
- **Paiement** : `inject(BillingService).startCheckout(plan, { cta, promo })`
  (`core/services/billing.service.ts`), jamais `BillingApi.checkout` directement. Il ouvre la
  **page de paiement de l'app** `/paiement?plan=…&cta=…&promo=…` (`features/checkout/`, hors coque,
  `authGuard`), commune à TOUTES les offres (fondateur, code partenaire, Premium avec ou sans essai,
  mensuel ou annuel). La page appelle `BillingService.createSession` (`ui: 'elements'`), monte le
  formulaire Stripe (Checkout Elements, `@stripe/stripe-js` épinglé 9.17.0 = Stripe.js `dahlia`) :
  Apple Pay / Google Pay / Link en boutons express, carte (CB co-badgée reconnue) et Klarna dans le
  formulaire. Textes par offre : `checkout-copy.ts` (fonction pure, testée) ; montant du jour lu dans
  la session. Après paiement : `/dashboard?checkout=success`. Si l'API renvoie `{ url }` (clé
  publiable absente), repli sur la page Stripe. Hauteur du formulaire figée après chargement
  (passer à Klarna ne fait rien bouger) ; colonne gauche collante en desktop.
- **Contrastes** : texte blanc sur un fond plein → `background: var(--primary)` (survol
  `--primary-hover`), jamais `var(--blue)` / `var(--blue-bright)` (trop clairs sous du blanc).
- Les couleurs restent propres à chaque app : l'admin suit sa maquette (teal, Geist), seules la
  structure et l'accessibilité sont partagées.
- Tests : `pnpm nx test front-ui` / `pnpm nx test front-auth` (config Vitest propre à chaque lib :
  l'exécuteur de l'app refuse les specs hors de sa racine). Une lib importée par l'app doit aussi
  être déclarée dans `resolve.alias` de `apps/app-mytradingcoach/vitest.config.mts`.

## Polling : `visibleInterval` obligatoire (SCA-B4, 2026-10-01)

Test de charge B9 : le polling faisait **la moitié** des requêtes de l'API. Règles :
- **Jamais `interval()` / `setInterval()` pour interroger l'API** : `visibleInterval(ms)`
  (`core/utils/visible-interval.ts`) — muet onglet caché, une émission de rattrapage au retour si
  une période a été manquée. Délais centralisés dans `core/constants/polling.const.ts`.
- **Donnée commune à tous** (contexte marché, calendrier éco) → **poussée par le socket `/eco`**
  (`EcoSocketService.marketContext$`, `newReleases$`), polling HTTP en **secours à 5 min**
  seulement, et rattrapage à chaque (re)connexion (`connected$`).
- Le socket `/eco` est piloté par **`SessionStore`** (connecté tant que la session est active,
  quelle que soit la page), plus par `session-live`.
- `/auth/me` : 5 min (`USER_SYNC`), et au retour sur l'onglet seulement si la dernière synchro
  date de plus d'une minute.
- Budget vérifié par `session.store.polling.spec.ts` : **< 3 requêtes/min par onglet en session**
  (hors quick-trade), **0 onglet caché**. Toute nouvelle donnée périodique doit tenir ce budget.
- **Admin** : `visiblePoll(request, { periodMs })` (`apps/admin-mytradingcoach/src/app/core/utils/visible-poll.ts`) :
  aucune requête onglet caché (une tout de suite au retour), espacement ×2, ×4, ×8 après échec, jamais
  deux requêtes en parallèle ; émet `{ ok, value | error }` sans terminer le flux. Utilisé par
  Surveillance (15 s, bandeau `VPS_UNREACHABLE`, boutons masqués si `readOnly`) et le dashboard (10 s).
- **Tout nouveau socket** (`io(...)`) étale ses reconnexions avec `...SOCKET_RECONNECT_OPTIONS`
  (`core/services/socket-reconnect.ts`, SCA-B4-07) : 1er essai entre 1 et 9 s, plafond 60 s. Sans ça,
  tous les onglets reviennent ensemble après un redémarrage de l'API.
- **Socket authentifié** (`/eco`, `/tradovate-live`) : `auth: (cb) => cb({ token: localStorage… })`
  (fonction : jeton relu à chaque reconnexion), garde `if (this.socket) return;` dans `connect()`, et
  nouvel essai espacé sur `disconnect` avec la raison `io server disconnect` (socket.io ne retente
  pas seul après un refus du serveur).
- **Dashboard** : les `effect` qui rechargent les analytics « après un nouveau trade / compte »
  ignorent tout tant que le store n'est pas `loaded()` (SCA-B4-04) : le premier chargement 0 → N
  n'est pas un ajout. Même garde pour toute réaction « le compteur a bougé ».

## Entonnoir Premium (2026-10-07)

`core/services/product-events.service.ts` : `track(event, place?)` / `once(...)` (une fois par écran et par
onglet), place = 1er segment de la route, envoi best-effort. Branché sur : `mtc-premium-lock` (`premium_seen`),
`mtc-plan-modal` (`plan_modal_open` à l'ouverture, `trial_click` sur « Essayer »), `App` (retour Stripe
`?checkout=success|canceled` → `checkout_return`), CTA « Créer mon compte » de la démo (sidebar). Nouveau
teaser Premium → `once('premium_seen')`. Admin : bloc « Entonnoir Premium » de `/acquisition`
(`features/acquisition/funnel.util.ts`, testé).

## Parcours d'inscription par source (oct. 2026)

`core/services/signup-funnel.service.ts` → `POST /public/funnel` par **`navigator.sendBeacon` en
`text/plain`** (repli `fetch` keepalive `text/plain`) : pas de requête préalable CORS, et l'étape part
même si la page change juste après (`register_submit` avant la redirection, `checkout_redirect` avant
Stripe). Anonyme : étape, source/medium/campagne, `inApp`, detail d'une liste fermée de `@mtc/shared`.
L'API lit ce corps en JSON sur cette route seulement (cf. nestjs.md). Ne pas revenir à HttpClient.
- **`register_view` dès l'arrivée** (oct. 2026) : script inline `#mtc-register-view` d'`index.html`,
  exécuté au chargement de `/register` sur `app.`, `dev.app.` et `beta.app.mytradingcoach.app` (URL de
  l'API déduite de l'hôte), AVANT le téléchargement de l'app : un visiteur qui part pendant le
  chargement est compté. Origine = UTM du lien, sinon `mtc_utm` de l'onglet, sinon site d'origine
  (mêmes règles que `resolveAcquisition` / `referrerHost`). Rien n'est envoyé si connecté
  (`access_token` + `user` en localStorage) ni en mode interne (`?internal=1` ou `mtc_internal`).
  Il pose `window.mtcRegisterView` : `SignupFunnelService.start()` ne renvoie alors pas `register_view`
  pour ce chargement (pas de double comptage), mais l'envoie encore après une navigation interne
  (connexion → inscription) ou sur un hôte sans script (local). Motif `inApp` = `IN_APP_UA_PATTERN`
  recopié : `src/index-register-view.spec.ts` vérifie qu'il est identique, et l'URL de l'API de
  chaque `environment.*.ts`. Nouvel environnement déployé → l'ajouter au script ET au test.
- ⚠️ **Chiffres « Page inscription » avant / après** : depuis la mise en prod de ce correctif (branche
  `fix/fuite-clic-inscription`, commits du 2026-10-17), `register_view` est compté dès l'arrivée et
  non plus après le chargement de l'app (≈ 3,9 s plus tard en 4G lente) ; un utilisateur connecté qui
  ouvre /register n'est plus compté. Les taux clic → page d'avant et d'après ne sont pas comparables.
- `RegisterComponent` : `start(origine)` à l'ouverture (origine = UTM résolues par
  `resolveAcquisition`, gardée en sessionStorage `mtc_funnel` car `mtc_utm` est effacé après
  l'inscription ; `register_view` sauf si déjà envoyé par `index.html`), `register_submit` si le
  formulaire est valide côté client, `register_success`, `register_error` avec
  `registerErrorCode(status)` (409 `email_taken`, 400/422 `validation`, 0 `network`, ≥ 500 `server`,
  sinon `other`). Pas de `register_view` si l'utilisateur, déjà connecté, est renvoyé vers `/dashboard`.
- `BillingService.startCheckout` → `trackCheckout(plan)` = `checkout_redirect` (detail `founder` /
  `premium`), **seulement si l'onglet est passé par /register** (`mtc_funnel` présent) : un abonné qui
  paie depuis le Profil n'est pas une étape du parcours.
- **Mode interne** : `https://app.mytradingcoach.app/?internal=1` (n'importe quelle page) →
  localStorage `mtc_internal=1`, lu au démarrage par `App` (`captureInternal`) : plus aucune étape
  envoyée, badge « interne » en bas à gauche (`mtc-internal-badge`, monté dans `App`). `?internal=0`
  annule. Propre au domaine : la landing a le sien.
- **Admin `/acquisition`, carte « Parcours d'inscription »** (au-dessus de l'entonnoir Premium) :
  `GET /admin/signup-funnel?days=7|30` (`AdminApi.signupFunnel`), onglets `section-tabs` période (7 j / 30 j,
  rechargement) et navigateur (Tous / intégré / normal, filtrage local). Logique pure testée dans
  `features/acquisition/signup-funnel.util.ts` : « Tous » additionne intégré + normal d'une même
  source/medium/campagne, ligne Total, taux = étape / étape précédente (`-` si la précédente vaut 0),
  erreurs fusionnées par source + code avec libellé (`errorLabel`). Colonnes : Visites → Clics CTA →
  Page inscription → Envois → Inscrits → Checkout. Valeur + taux dans un même `span` (cartes mobiles).

- **Carte « Engagement landing »** (19/10/2026, sous le parcours d'inscription) :
  `GET /admin/landing-engagement?days=7|30` (`AdminApi.landingEngagement`), onglets période propres.
  Logique pure testée dans `features/acquisition/landing-engagement.util.ts` : une section par page
  (Accueil `/`, Prop firm `/prop-firm`, même vide) avec ligne Total puis lignes source · medium ·
  campagne. Colonnes `ENGAGEMENT_COLUMNS` : Vues · 25/50/75/100 % · 10/30/60 s · Règles, taux = valeur
  / vues de la ligne (pas l'étape précédente). Mêmes classes que le parcours (`signup-*`).

## Offre fondateur et codes partenaires (#525, 2026-10-08)

- **Offres de l'utilisateur** : `OffersStore` (core/stores) ← `GET /billing/offers` (offre ouverte +
  places, place fondateur, éligibilité, `refundUntil`, code partenaire actif, intervalle). Chargé À LA
  DEMANDE (`load()` : modale, cadenas, Profil), une fois par utilisateur, `refresh()` après paiement /
  changement d'intervalle, délai max 10 s (une session périmée ne le fige pas). Pas dans `/auth/me`
  (interrogé toutes les 5 min). Démo : jamais chargé. **`status`** (#578) : `idle` (rien demandé :
  déconnecté, démo) · `loading` · `loaded` · `error` ; un rafraîchissement d'offres déjà là reste
  `loaded`. `load({ silent: true })` / `refresh({ silent: true })` : requête en `SILENT_ERRORS` (pas de
  toast), réservé à la modale et au chargement anticipé qui l'alimente ; Profil et cadenas gardent le toast.
- **Chargement anticipé** (#578) : dès la réponse de l'inscription (`RegisterComponent`, si `offerFlow()`)
  ou de la connexion (`LoginComponent`, si `needsChoice()`), `offersStore.load({ silent: true })` en
  parallèle de la navigation ; sur `/register` avec un lien d'offre, le code de la modale est importé
  quand le navigateur est inactif (`whenIdle`, même chunk que le `@defer` de l'hôte). `/billing/offers`
  exige un compte : impossible de charger avant l'inscription. Un échec du chargement anticipé est
  rattrapé sans bruit par le `load()` de la modale à son ouverture.
- **Intention du lien** : `OfferIntentService` capture `plan=founder|premium`, `promo`, `cta` au
  démarrage (`App`, avant toute redirection) en sessionStorage `mtc_offer_intent`. `plan=founder` ou
  `promo` → pas de checkout direct à l'inscription : `/dashboard`, puis `OfferIntentHostComponent`
  (monté dans le shell `sidebar`, modale en `@defer`) ouvre `mtc-plan-modal` avec `[preset]`.
  `plan=premium` seul → checkout direct comme avant. Déjà connecté sur `/register` avec une intention
  → `/dashboard`. Jamais pour un abonné `active` / `past_due` ni la démo. Compte déjà Premium
  autrement (admin, bêta, Premium offert, essai) venu d'un lien : modale seulement si
  `founderAvailable` (offres chargées), sinon intention oubliée — jamais de modale « 49 € » à
  quelqu'un qui a déjà Premium (lien de la campagne fondateur).
- **`mtc-plan-modal`** : entrées `cta` (défaut `modale`) et `preset`. Options exclusives (radio) :
  Fondateur (si `founderAvailable`), Code partenaire (une fois validé), Premium. Présélection : code du
  lien s'il est valide, sinon fondateur, sinon Premium ; un code saisi à la main et valide est choisi.
  Champ « Code partenaire » validé en direct (`GET /billing/partner/:code`, debounce 400 ms, raison
  précise du refus). Checkout : fondateur → `founder_*` sans `promo` ; code → `premium_*` + `promo`
  (jamais de cumul). Sous-titre, CTA et ligne de prix suivent l'offre choisie.
- **Aucun choix avant les offres (#578)** : `choice()` vaut `null` tant que `status` ≠ `loaded` →
  emplacements neutres (`.offer-skel`, aucun prix), CTA désactivé « Chargement des offres… », et
  `confirmPlan()` refuse aussi côté code (`canConfirm`). Avant le correctif, la modale s'ouvrait avant
  `/billing/offers` : seul « Premium 49 € » était proposé quelques centaines de ms et un appui partait en
  `premium_monthly` au lieu du fondateur demandé par le lien. Échec : `mtc-error-state` + « Réessayer »
  (`refresh({ silent: true })`), CTA masqué, jamais de repli silencieux sur le Premium.
- **Lien `plan=founder` sur une offre inaccessible** : la raison (`founderRefusal`, message
  `FOUNDER_INELIGIBLE_MESSAGES[ineligibleReason]` de `@mtc/shared`, le même que le refus du checkout),
  bloc `.offer-refusal`, et AUCUNE présélection (CTA « Choisis ton offre ») : le Premium n'est jamais
  choisi à la place du fondateur. Sans lien fondateur (cadenas, Profil) : présélection inchangée.
- **`mtc-premium-lock`** : bouton (plus un lien vers `/parametres`, route inexistante) →
  `OfferIntentService.open('cadenas')` : la modale est rendue par l'hôte du shell (un `position: fixed`
  dans une carte floutée serait mal placé). Libellé « dès 29 €/mois (offre fondateur) » si accessible.
- **Profil > Abonnement** : badge « Fondateur n° X », tarif bloqué et perte en cas de résiliation,
  « Satisfait ou remboursé : demander le remboursement » (mailto support@, jusqu'à `refundUntil` : le
  remboursement se fait dans Stripe, le webhook `charge.refunded` fait le reste), « Tarif partenaire
  CODE : … à vie / jusqu'au », bouton mensuel ↔ annuel (`POST /billing/interval`, confirmation), rappel
  neutre sous « Gérer mon abonnement » pour un fondateur / partenaire. Modale du Profil : `cta="profil"`.
- Tests JIT : les entrées signal ne s'affectent pas par `setInput` → remplacer le signal d'entrée sur
  l'instance AVANT le premier `detectChanges` (`plan-modal-offers.spec.ts`).

### Admin : inscrits d'une campagne (#625)

Page Utilisateurs : le filtre vit dans l'URL (`/users?source=&medium=&campaign=`, relu à chaque
changement de `queryParamMap`), bandeau « Inscrits de … · N inscrits » + « Retirer le filtre ».
Entrées : Acquisition › Détail par campagne (« Inscrits total » cliquable, triplet exact via
`acquisitionQueryParams`, null → `-`) et la ligne « Acquisition » de la fiche utilisateur. Colonne
Abonnement : badge « Offert » pour un mois Premium offert (plan FREE + `trialEndsAt` futur).

### Admin : liaison compte ↔ plan prop firm (#612)

Dashboard, bandeau « Fidélisation & activation » : 6e stat `kpi-plan-links` (taux, reliés / connectés),
lien vers `/brokers`. Détail en tête de la page Brokers : `mtc-admin-plan-links-card` (réponses des
comptes sans plan, firms absentes du catalogue). Specs admin : builder Angular, `templateUrl` compilé
directement (pas de `?raw` comme dans l'app).

### Admin : offre fondateur et codes partenaires (#525)

- Dashboard : 7e KPI « Fondateurs » (`X / 200`, `N actifs · R restantes`, barre fine, badge « fermée »)
  → `/subscriptions?filtre=fondateurs`. La bande `dash-kpis` passe à 7 colonnes.
- Abonnements : KPI `cols-5` (+ Fondateurs) et onglets `section-tabs` Abonnements / Fondateurs /
  Codes partenaires, pilotés par `?filtre=fondateurs|codes`. Composants `founders-tab` (interrupteur
  « Ouvrir l'offre » avec confirmation DANS la page, date de fin, récap par clic, tableau filtrable et
  paginé, liens vers la fiche) et `partner-codes-tab` (formulaire création / modification, aperçu en
  une phrase, aide « effet sur l'annuel », liste « utilisés / max », activer / désactiver, abonnés par
  code). Styles partagés `offers-tabs.css` (champs repris de la page Ambassadeurs).
- Colonne « Montant » = montant réellement payé (`realAmountLabel`, `core/utils/offers.util.ts`, testé)
  + étiquette « Fondateur n° X » / « Code X ».
- Revenus : carte « MRR par tarif » (`mrrBreakdown` : normal / fondateurs / codes partenaires).
- Fiche utilisateur : badge « Fondateur n° X » ou « Code X », ligne avec date, intervalle et « Tarif
  perdu le … » / « Remboursé le … », ou conditions figées du code (`AdminUserDetail.offer`).
- Maquette `admin-mytradingcoach.html` absente en local au moment du #525 : design repris des
  composants existants (KPI, `.tbl`, `.badge`, `.section-tabs`, champs Ambassadeurs).


## Admin : PWA et notifications push (2026-10-15)

- `@angular/service-worker` (épinglé à la version de `@angular/core`) : `provideServiceWorker`
  **désactivé en dev** (`isDevMode()`), `ngsw-config.json` déclaré dans `project.json`
  (`serviceWorker`). Manifest « MTC Admin » + icônes dans `public/icons/` ; les PNG se régénèrent
  depuis `icon.svg` : `node tools/scripts/generate-admin-icons.mjs`. Balises iOS dans `index.html`.
- `core/push/push.service.ts` (repris de xmr-trader) : `browserSupport()` → `ios-not-installed`
  (iPhone hors écran d'accueil), `unsupported`, `denied`, `server-disabled`, `supported` ;
  `BROWSER_ENV` remplaçable dans les tests. Page `/notifications` : interrupteur de l'appareil,
  événements (`ADMIN_PUSH_EVENT_LABELS` de `@mtc/shared`), « Tester la notification ».
- ⚠️ **Cache** : `ngsw-worker.js`, `safety-worker.js`, `worker-basic.min.js` doivent être servis
  **sans cache** (sinon le SW ne se met plus jamais à jour). Nginx : `location =` dédiées dans
  `spa-releases.conf` (admin servi par l'ancien VPS, pas de Vercel ; voir `deploy.md`).
- **Installée sur l'écran d'accueil (iOS)** : `viewport-fit=cover` + status bar `black-translucent`
  + `theme-color` = `--bg` (#070809) → la page passe **sous** la barre d'état. Marges de sécurité :
  variables `--safe-top/right/bottom/left` (`:root` de `styles.css`, `env(safe-area-inset-*)`), lues
  par `.topbar`, `.sidebar`, `.content`, `.log-terminal`, toasts, `.modal-overlay`, tiroir de la
  surveillance. Nouvel élément fixe ou collé à un bord → ces variables, jamais `env()` en dur.
  Contrôle Playwright : surcharger les variables (`:root{--safe-top:47px;--safe-bottom:34px}`),
  Chromium ne simule pas les safe-area. En-tête < 480 px : `.tb-meta` masqué, statut réduit au point.

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

## Autoremplissage navigateur (2026-10-18)

- Règle globale dans **`src/styles.css`** (`input/textarea/select:-webkit-autofill`) : ombre interne
  `var(--autofill-bg, var(--bg-2))`, `-webkit-text-fill-color: var(--text)`, `background-clip:
  padding-box !important` (sinon le fond clair imposé passe sous la bordure semi-transparente : le
  raccourci `background:` des champs de composant remet `border-box`). Champ sur un autre fond →
  poser `--autofill-bg`.
- ⚠️ `src/styles/global.css` n'est **importé nulle part** (seul `styles/theme.css` l'est) : une
  règle globale va dans `styles.css`, pas là.
