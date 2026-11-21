# Compte démo : seed et comptes

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Compte démo : le seed doit rester récurrent (PROMPT-192) · 2026-08-28 -->
> **Origine** : `nestjs.md` · « Compte démo : le seed doit rester récurrent (PROMPT-192) » · 2026-08-28

### Compte démo : le seed doit rester récurrent (PROMPT-192)

`seedDemo()` génère des dates **relatives au moment du run**. Appelé une seule fois
(endpoint admin), il vieillit en silence : seedée le 2026-06-07, la démo prod affichait
le 2026-08-28 « P&L jour +0$ · Win Rate 0% · 0 trade loggé » et une session active depuis
1978 h, alors que les données live (marché, calendrier, news) étaient pleines — un
prospect voyait un produit vide.

Filets posés par `DemoSeedCron` (`modules/admin/demo-seed.cron.ts`) :
- `@Cron('20 3 * * *')` → re-seed quotidien ;
- `onModuleInit` gardé par `IS_CRON_WORKER === 'true'` (**obligatoire** : sinon les 8
  workers du cluster purgent/recréent le même user en concurrence) → rattrape une API
  restée éteinte plus d'une journée.
- **Connexion démo** (`AuthService.demoLogin`, 2026-10-06) → `DemoSeedService.ensureFresh` :
  re-seed si la démo est périmée (`isStale` : absente, sans trade, ou rien depuis le dernier jour
  ouvré), sous verrou Redis `demo:reseed-lock` (120 s, un seul re-seed dans le cluster ; verrou
  pris → démo actuelle servie). Un échec ne bloque jamais la connexion. Raison : le worker de
  **dev** tourne sans cron (`IS_CRON_WORKER=false` dans `.env.dev`, process unique hors
  `NODE_ENV=production`) ; sa démo était restée au 2026-06-07 (aucun compte, session ouverte
  depuis 2 900 h). `DemoSeedService` vit dans `DemoSeedModule` (importé par Admin et Auth).
- **Un seul re-seed à la fois, partout** (#1066, B5) : cron, `POST /admin/seed-demo` et connexion
  démo prennent le même verrou `demo:reseed-lock`. Verrou pris → 409 côté admin, tour sauté (log)
  côté cron, démo actuelle servie côté connexion. Le verrou porte un jeton aléatoire et n'est rendu
  que s'il porte encore ce jeton (script Lua) : un seed plus long que le TTL ne libère jamais le
  verrou d'un autre.
- **Re-seed en une transaction** (#1066, B6) : `seedDemo` tourne dans `prisma.$transaction`
  (délai 90 s, sous le TTL de 120 s du verrou). Un visiteur garde l'ancienne démo jusqu'au commit ;
  sans transaction, il voyait 0 trade pendant la purge (mesuré sur banc local : 3 à 6 s par
  re-seed). Les fonctions du seed prennent un `SeedDb` (= `Prisma.TransactionClient`, un
  `PrismaClient` reste accepté). Ne jamais y appeler `$transaction` ni un service Nest.
- **Cache des statistiques** (#1066, B7) : après le commit, `bumpAnalyticsVersion` du compte démo
  (sinon 300 s de chiffres de l'ancienne démo).
- **Session live présente EN SEMAINE** (vitrine, 2026-10-18 : « si le visiteur ne voit pas le live,
  c'est pas bon » ; plus le week-end depuis #977) : le seed crée à chaque run de semaine une session ACTIVE du jour sur Apex, avec une
  position saisie à la main **encore ouverte** (`DemoDay.openTrade`, MNQ, SL + TP, R/R 1 : 2, hors
  stats) rattachée à la session. **Séance vivante à l'heure de la visite** (2026-11-09,
  `demoTodaySlot`) : en semaine de 00:40 à 23:00 (Paris, heures CME), 3 ou 4 trades du jour AVANT
  `now` (Breakout gagnant, Reversal perdant, Scalping gagnant, Pullback gagnant : meilleur trade ET
  trade à revoir au débrief), espacés de 30 min (resserrés juste après minuit), puis la position
  ouverte **6 min avant `now`**. `isStale` re-seede à la connexion démo quand cette position a plus
  de **45 min** (`OPEN_TRADE_MAX_AGE_MS`) : au plus un re-seed toutes les 45 min, les autres
  visiteurs gardent des données stables entre-temps. Hors créneau : coupure de 23:00 (la journée CME
  suivante commence) → aucun trade du jour, position ouverte à 22:50 ; avant 00:40 → position de la
  dernière séance à 21:40. **Week-end (décision de Greg du 2026-11-13, #977)** : marché fermé,
  **ni session live ni position ouverte** ; la dernière séance est celle du vendredi (`kind:
  'yesterday'`), CLÔTURÉE avec humeur et réflexion. `GET /session/today` la sert au compte démo
  (`getTodaySession(userId, isDemo)` : séance clôturée depuis le début de la journée CME du vendredi,
  démo seulement ; les vrais comptes gardent la journée CME en cours) → l'écran Session du jour s'ouvre sur le
  Débrief, jamais sur « Démarrer la session » (#880). Aucun trade un samedi / dimanche (garde-fou
  `assertDemoCalendar`, il couvre aussi `openTrade`). `isStale` : en semaine, re-seed si aucune
  session n'est active pour la journée de trading en cours (`activeSessionWhere`) ; le week-end,
  re-seed s'il reste une session ACTIVE ou une position ouverte (seed du vendredi soir) ; toujours
  re-seed si le dernier trade CLÔTURÉ est antérieur à la séance attendue. Re-seed 45 min en
  semaine : gardé (même décision).
- **« Aujourd'hui » = journée de trading CME**, jamais minuit serveur : `getTodayTrades`,
  `getTodaySession` et le rattachement des trades à la clôture (`closeSession`, fenêtre
  `[tradingDayStart, tradingDayEnd[`) utilisent les mêmes bornes que la session active (audit des
  chiffres, lot 3 : pendant les semaines de décalage d'heure, un trade à 23:30 Paris sortait de la carte live).
- **Trade encore ouvert gardé après la bascule** : `getTodayTrades` = trades du jour **ou** trade sans
  P&L rattaché à la session active (`sessionId`, `pnl: null`). Vaut pour tous les comptes (position
  ouverte à 23:50) et sert la position de la vitrine.
- **Les deux comptes prop firm de la démo sont « connectés »** (vitrine, faux jeton, une connexion
  et des clôtures officielles par compte, `tradovateAccount` dans `demo-data/config.ts`) : la session
  live exige un compte connecté pour montrer le suivi prop firm, et « Mes comptes » n'affiche plus de
  bouton « Connecter » orange sur Tradeify.

Invariants verrouillés par `demo-seed-idempotence.spec.ts` : purge **avant** recréation
et **scopée `userId`** (un re-run remplace, il n'empile pas) · tous les trades dans les
`DEMO_WINDOW_DAYS` (42, soit 6 semaines) derniers jours, la vue « 1M » restant pleine · J-0 et
J-1 peuplés · en semaine, session du jour ACTIVE démarrée aujourd'hui avec une seule position
ouverte (SL + TP) ; le week-end, aucune session ACTIVE ni position ouverte, séance du vendredi CLÔTURÉE · **aucun trade après `now`** ni un samedi / dimanche (même
quand le cron tourne à 03:20 : les trades du jour sont calés avant l'heure du run) ·
P&L total < 15 % du capital et pertes visibles (sobriété AMF : on montre la
fonctionnalité, jamais une performance). Le capital n'y est **jamais en dur** : les tests
le relisent depuis l'upsert du seed, sinon chaque rééquilibrage (25 000 → 55 000) fausse
silencieusement le ratio au lieu d'échouer.

<!-- Origine : nestjs.md · Comptes de trading de la démo (PROMPT-193) · 2026-08-28 -->
> **Origine** : `nestjs.md` · « Comptes de trading de la démo (PROMPT-193) » · 2026-08-28

### Comptes de trading de la démo (PROMPT-193)

Le seed créait 56 trades mais **aucun `TradingAccount`** : trades « flottants »
(`accountId` null). Le dashboard lit les trades bruts et affichait un capital plein,
pendant que « Mes comptes » et le sélecteur agrégé, qui passent par les comptes,
affichaient **0 $ / 0 trade / 0 compte**. Deux pages qui se contredisent.

`DEMO_ACCOUNTS` crée 2 comptes prop firm ACTIVE en USD (PROMPT-215) : `Apex 50k · Éval #2`
(EVALUATION) et `Tradeify 50k · Funded` (FUNDED), **futures d'indices US uniquement**
(MES / MNQ, quelques ES / NQ). Le compte perso Forex & Crypto et l'or ont été retirés : la
démo s'adresse à des traders de futures prop firm. Deux comptes plutôt qu'un : le
multi-comptes est l'une des ancres Premium (`plans.md`).

**Comptes perdus de la démo (compte perdu, phase 3)** : `demo-data/lost-accounts.ts` ajoute
`Apex 50k · Éval #1` (FAILED, plancher dépassé), dont l'Apex actif `#2` est la nouvelle tentative,
et `Lucid 25k · Flex` (ARCHIVED). La démo montre ainsi la ligne « 2 comptes exclus des chiffres » et
l'interrupteur des statistiques. **Pas de compte PASSED dans la démo** (décision du 2026-10-21) : il
serait compté dans les chiffres et ferait passer le P&L « Tout » de +1 261 à +4 357 $ et le capital
de 125 000 à 175 000 $ ; le statut Validé est couvert par les tests unitaires et d'intégration. Contrat préservé : aucun de ces comptes n'est ACTIVE, donc Σ `startingBalance` des
comptes ACTIVE === `STARTING_CAPITAL`. Leurs trades (un par jour ouvré, MNQ, frais réels) tombent
AVANT la fenêtre de 42 jours : récaps, débriefs, journal de risque, `meetsTargets` et vue « 1M » ne
bougent pas. Aucune connexion broker sur ces comptes. Trades réalistes : setups en rotation proche des parts du
profil (Scalping, Pullback, Breakout, Range, Reversal, News), actifs MNQ / MES / NQ / ES (2 micros ou
1 mini, frais de l'instrument), plusieurs heures dont une séance de Londres. Module pur (tsx).
**Contraste des setups** (`setupsContrasted`, `model.ts`) : vérifié sur le tirage principal ET après
l'ajout du compte statique `elite` (`secondaryMeetsTargets`) ; sans ça, ses trades à résultat forcé
faisaient passer Pullback ou Range devant Breakout certains jours (4 samedis sur 30 avant correction).
Robustesse : `DEMO_SEED_DATE=AAAA-MM-JJTHH:MM:SS` rejoue `demo-seed-idempotence.spec.ts` à une date simulée. `DemoReadOnlyGuard` reste
la seule barrière des mutations (« Nouvelle tentative », « Archiver », suppression : 403 et invite
« Crée ton compte » côté front).

**Un trader réaliste, pas un gagnant parfait (PROMPT-215, validé par Greg).** `buildDemoDataset(now)`
(pur, sans base) génère ~6 semaines de jours ouvrés, 2 à 4 trades par jour, frais réels
(1,24 $ A/R par micro, 4,50 $ par mini) dans `commission`, `pnl` brut. Puis il cherche,
de façon déterministe, le premier tirage qui respecte `meetsTargets` :
- win rate NET 52-57 % ;
- 35-45 % de journées rouges ;
- brut 1 200-1 800 $, net 650-1 150 $, frais 470-700 $ ;
- setups contrastés : Breakout le meilleur, Reversal perdant, **Scalping positif en brut
  et négatif en net** ;
- éval Apex en cours, drawdown visible mais sous 50 % du seuil ;
- une journée de **revenge trading** : ré-entrées < 2 min, taille doublée, sans stop.

La note d'exécution est calculée comme en prod (barème A par trade, barème B par compte).
Il y a un débrief hebdo par semaine terminée (sections par compte) et un récap par jour de
trading, avec des textes dérivés des vrais chiffres générés. Le texte figé `DEMO_INSIGHTS`
(`ai.service`) y est aligné, en qualitatif : les chiffres varient légèrement selon le jour
du run.

**Règles prop firm : de vraies valeurs, jamais un palier inventé** (PROMPT-195).
Le compte porte les règles réelles Apex 50k Full Evaluation — base 50 000, objectif
+3 000, trailing drawdown 2 500. L'itération précédente utilisait un 20k générique que
*aucune* firme ne propose : un prospect qui connaît le marché le repérait. Si un jour on
change de firme ou de palier, reprendre des valeurs réelles, ou revenir à un libellé
sans marque — mais pas une marque sur un palier fictif.

**Ce que la démo n'affirme pas** : renseigner les règles de la firme n'est pas prétendre
reproduire son calcul officiel. L'app estime marge et pacing depuis les seuls trades
loggés — pas de trailing intraday, pas de positions ouvertes, pas de fuseau. C'est déjà
porté par `RULE_DISCLAIMER` (`accounts.service`) et la clause conformité du
`DEBRIEF_SYSTEM_PROMPT` : ne rien écrire dans la démo qui les contredise. L'éval doit
aussi rester **en cours** (P&L < objectif) et loin du seuil de liquidation — une éval
déjà passée se lirait comme une promesse de réussite.

**Contrat de cohérence, à ne pas casser** :

```
Σ startingBalance des comptes ACTIVE === PROFILE.startingCapital   (50 000 + 50 000 = 100 000)
```

`dashboard.baseCapital` somme les `startingBalance` **dès qu'un compte existe** et ne
retombe sur `user.startingCapital` que s'il n'y en a aucun ; `accounts.trackedCapital`
fait la même somme. Tout écart et les deux pages divergent à nouveau. Changer un
`startingBalance` impose donc d'ajuster l'autre compte, pas `startingCapital`.

Deux pièges d'ordonnancement :
- **Purger `tradingAccount` APRÈS `trade` et `tradeSession`** : les deux FK sont en
  `onDelete: SetNull`. Purger les comptes en premier détache les lignes au lieu de les
  supprimer — elles survivent au re-seed, orphelines.
- **Aucune session sans compte** : `SessionService.startSession` garantit
  « anti-NULL, jamais de session sans compte ». Les sessions démo portent donc un
  `accountId` (le compte futures), sinon la démo ne reflète pas l'app réelle.

## Tirage mensuel et compte démo (#1158, 2026-11-21)

Le seed démo ne crée **aucune** ligne `GiveawayDraw` / `GiveawayWin` : le prompt interdit tout faux
gagnant et tout faux message, et une ligne démo fausserait les compteurs publics (landing, page de
l'app). La page « Concours du mois » de la démo est fabriquée par `GiveawayPublicService.appState`
(`demo: true`, onglet visible, compteurs à 0, aucun gagnant, mention « exemple » dans l'app) ; le
statut « Encore N trades » / « Tu es dans le tirage » se calcule sur les trades démo du mois civil en
cours, que le re-seed nocturne date en relatif (`daysAgo`) : les premiers jours d'un mois, la démo
peut afficher « Encore N trades », ce qui est exact. Rien à enrichir dans le seed tant que la page ne
montre que ces données.
