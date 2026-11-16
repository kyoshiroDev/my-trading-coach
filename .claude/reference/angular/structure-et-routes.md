# Structure de l'app et de l'admin, routes, notes par écran

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : angular.md · Structure · 2026-04-25 -->
> **Origine** : `angular.md` · « Structure » · 2026-04-25

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
- **Calendrier éco, jour passé (2026-11-09)** : `eco-calendar.component.ts` relit les analyses
  enregistrées du jour affiché (`getReleaseAnalyses`, une lecture par jour, au choix du jour) et
  n'appelle JAMAIS `analyze-result` pour un jour passé. Les annonces de la vue semaine (`range`)
  n'ont pas de `date` : c'est celle du jour sélectionné. Clé du cache : `date|nom sans suffixe`.
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
- **Compte de la session (Pré-session, #880)** : `session-account.util.ts`. Le message « Choisis un
  compte pour lancer la session » ne s'affiche que si AUCUNE séance n'est active, que l'utilisateur a
  des comptes et que l'en-tête est sur « Tous les comptes ». Séance active : la liste montre le compte
  de la séance (désactivée), quel que soit le choix de l'en-tête. La démo a toujours une séance
  active après le seed (même le week-end ; en semaine elle est calée sur l'heure de la visite, le
  `demo-login` reseede une démo périmée ou dont la position ouverte a plus de 45 min).
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
mentir. Sous 768px : 52px, la phrase longue (`.demo-banner-long`) tombe. Depuis #1029, ce bandeau
du haut n'a plus de bouton : il dit seulement « Mode démo » (le CTA est le bandeau du bas, ci-dessous).

Bandeau d'inscription du bas (#1029) : `--demo-cta-h` (`.main-content.has-demo-cta`, tokens
`--demo-cta-h-desktop` 64 px / `--demo-cta-h-mobile` 72 px de `theme.css`, **zone sûre du bas de
l'iPhone comprise**), même principe : une vue calée sur `100vh` retranche aussi
`var(--demo-cta-h, 0px)` (Pré-session et Session live le font).

**Toute nouvelle vue calée sur `100vh` doit retrancher `var(--demo-banner-h, 0px)`.**
**Tout élément `position: sticky` du contenu (topbar, sélecteur de compte, en-tête propre d'une
page) se cale sous le bandeau : `top: var(--demo-banner-h, 0px)` (+ ce qu'il y a au-dessus).** Le
bandeau est collant à `top: 0` avec `z-index: 50` : un élément collé à 0 passe dessous en défilant
(titre de la topbar illisible en démo à 390 px, #721). Verrouillé par `topbar-burger-alignment.spec.ts`.
