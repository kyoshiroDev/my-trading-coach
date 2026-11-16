# Autopsie d'un compte grillé (#669)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md`, `.claude/agents/prisma.md`, `.claude/agents/tests.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Autopsie d'un compte grillé (#669, 2026-10-23) · 2026-10-23 -->
> **Origine** : `nestjs.md` · « Autopsie d'un compte grillé (#669, 2026-10-23) » · 2026-10-23

## Autopsie d'un compte grillé (#669, 2026-10-23)

Module `accounts/incidents/` (dans `AccountsModule`, client Anthropic global : pas de cycle).
- **Détection** `AccountIncidentsService.detect(userId, accountId, source)` : relit `AccountsService.list`
  (aucune règle recalculée) ; compte ACTIVE, `drawdown.breached` → incident `drawdown`
  (`period = 'account'`) ; `dailyLoss.breached` (Premium seulement, métrique non calculée en Gratuit)
  → `daily_loss` (`period = AAAA-MM-JJ`). `createMany … skipDuplicates` + unicité
  `accountId + kind + period` = un seul incident, même si plusieurs déclencheurs tirent ensemble.
  **Jamais pour un compte démo** (son incident vient du seed). `detectQuietly` = best-effort.
- **Déclencheurs** : `PropAlertsService` (niveau `breached` drawdown / perte du jour, source `live`),
  `TradesService.importTrades` (fin de lot, par compte touché : import CSV, synchro et historique
  Tradovate) et `TradesService.create` hors lot (saisie), source `sync`.
- **Confirmation** : `PATCH /accounts/:id` (`UpdateAccountRequestDto`) passe par
  `AccountIncidentsService.updateAccount`. Un compte ACTIF passé en `FAILED` ou `ARCHIVED` relance la
  détection ; il ne pose `failedByIncidentAt` sur l'incident ouvert (une seule fois, filtre
  `failedByIncidentAt: null`) **que si le corps porte `confirmIncident: true`**, envoyé par la seule
  feuille « … est échoué ». Le formulaire d'édition ne l'envoie jamais : son archivage ne confirme rien
  (revue #712). `confirmIncident` est retiré avant `AccountsService.update` (le DTO part dans Prisma).
  Passé en `FAILED` sans limite ouverte : incident `manual` (chronologie de la dernière séance, jamais
  réactivable). Simple archivage sans limite franchie : rien.
- **Routes** : `GET /accounts/:id/incidents` (ouverts) · `GET …/:incidentId` (chronologie, KPI, série
  de distance, 3 constats, `ai` stocké, `canReactivate` ; **aucun appel IA**) · `GET …/:incidentId/analysis`
  · `POST …/:incidentId/dismiss`. `GET /accounts` porte `openIncidentId`.
- **Chronologie et constats** : `incident-report.ts` (pur), recalculés à chaque lecture depuis
  `Trade`, `BehaviorAlert`, `PropRiskEvent` de la journée CME et les 60 séances précédentes. Distance
  = marge relevée à la détection (`data.remaining`) reconstruite trade par trade sur le réalisé
  (`tradedAt` = première sortie : estimation, `estimatedDistance: true`). Constats : gabarits chiffrés,
  aucun conseil ni promesse (test dédié).
- **Analyse IA (Premium)** : générée à la première demande, `max_tokens` 400 (`INCIDENT_AI_MAX_TOKENS`),
  feature `incident`, prompt = faits déjà calculés (`incident-ai.prompt.ts`). Le message dit toujours
  ce qu'on sait du franchissement (heure, « déjà franchie avant le premier trade », « non connue », ou
  pour `manual` « Aucune limite relevée ») et le système interdit toute autre limite : sans ça, un échec
  marqué à la main recevait une « limite journalière franchie » inventée. Heure d'entrée : pas en base
  (`tradedAt` = sortie), donc le message porte « Heure d'entrée non enregistrée. » et le système
  interdit de la déduire ou de la recopier depuis la sortie (sinon « À 17h30, tu entres en position »).
  `IncidentTrade.enteredAt` (optionnel) la transmet le jour où une source la fournit. Règle générale :
  une heure, un montant ou un fait n'est cité que s'il est dans le message ; le test « aucune donnée
  absente présentée comme un fait » (`incident-report.spec.ts`) le vérifie cas par cas. Jamais pour la démo,
  jamais sans `AI_ENABLED`. Écrite par `updateMany({ where: { aiAnalysis: null } })` : jamais remplacée.
  Débit borné à trois niveaux (revue #712) : `@Throttle` 6/min sur la route ; verrou Redis
  `incident-ai:<id>` (NX, 1 h) contre la double ouverture, **jamais supprimé** : après un échec ou une
  réponse vide (facturée), il est ramené à `AI_RETRY_DELAY_S` (2 min) ; compteur
  `incident-ai-tries:<id>:<jour CME>` (`INCR`, 24 h), au plus `AI_MAX_TRIES_PER_DAY` (3) essais par
  incident et par jour, réussis ou non.
- **« Ce n'est pas un échec »** : `dismissedAt` (jamais recréé) ; remet le compte en ACTIVE seulement si
  `failedByIncidentAt` et statut encore `FAILED` / `ARCHIVED`, via `AccountsService.update` (quota).
- **Constats de marge** (`incident-report.ts`) : marge affichée avec son signe ; `crossingPoint` = passage
  d'au-dessus de la limite à zéro ou dessous. Marge déjà ≤ 0 avant le premier trade : « Limite estimée
  déjà franchie avant la séance », jamais de franchissement daté. Un seul trade : « 1 trade à HH:MM ».
- **Démo** : `demo-data/lost-accounts.ts` (`lastSession`, `buildLostDemoIncident`,
  `DEMO_INCIDENT_ANALYSIS`) : séance de casse sur « Apex 50k · Éval #1 », alerte « pertes d'affilée »,
  paliers 25 % / 10 % / dépassé, échec confirmé, texte d'analyse PRÉENREGISTRÉ (vitrine démo seulement :
  `seed:user` n'en pose pas). La page le signale comme exemple. Ses montants sont NETS, comme la
  chronologie (test qui les recalcule depuis les trades du seed).
- E-mail : pas encore branché (texte à valider par Greg ; seulement si `notificationsEmail` déjà actif,
  formule « d'après tes trades enregistrés, la limite semble franchie », jamais démo).

<!-- Origine : angular.md · Autopsie d'un compte grillé (#669, 2026-10-23) · 2026-10-23 -->
> **Origine** : `angular.md` · « Autopsie d'un compte grillé (#669, 2026-10-23) » · 2026-10-23

## Autopsie d'un compte grillé (#669, 2026-10-23)

Maquette `maquettes/mockup-autopsie.html` (fait foi). Route **paresseuse**
`/accounts/:accountId/autopsie/:incidentId` → `features/accounts/autopsy/account-autopsy.component`.
- Mise en forme pure dans `autopsy.util.ts` (en-tête, KPI, lignes, courbe SVG `distanceChart`,
  `frenchSpacing` : espace insécable devant `: ; ! ?` des constats et de l'IA). Fixture de test :
  `autopsy.fixture.ts` (jamais importer une fixture depuis un `*.spec.ts` : ses tests seraient rejoués).
- Contrat : `libs/shared/src/contracts/incident.ts`. Client : `AccountsApi.incidents / incident /
  incidentAnalysis / dismissIncident`.
- Gratuit : chronologie et constats ; carte IA verrouillée (libellé unique des paywalls, `PaywallCtaService` :
  fondateur, sinon « Essayer Premium · 30 jours d'essai → » selon `trialAvailable`, sinon « Passer à Premium → »). Premium, `ai.status = 'pending'` : UN appel à `…/analysis` à l'ouverture.
  Démo : texte préenregistré, badge « Exemple » + note « sans appel à l'IA ».
- Tentative suivante déjà créée (`LostAccountFlowService.newerAttempt`, `@mtc/shared`) : « Nouvelle
  tentative » (Mes comptes) et « Repartir… » (autopsie) deviennent « Voir Apex 50K #2 » (`openAttempt` :
  ce compte sélectionné, `/accounts`). 409 `RETRY_EXISTS` à la création : ni toast d'erreur ni message
  de quota, feuille fermée, liste rechargée (le bouton bascule).
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

<!-- Origine : prisma.md · Autopsie d'un compte grillé (#669, 2026-10-23) · 2026-10-23 -->
> **Origine** : `prisma.md` · « Autopsie d'un compte grillé (#669, 2026-10-23) » · 2026-10-23

## Autopsie d'un compte grillé (#669, 2026-10-23)

`AccountIncident` (migration `20261023120000_account_incident`, table nouvelle, additive, cascade sur
le compte). `@@unique([accountId, kind, period])` : `period = 'account'` pour `drawdown` et `manual`
(une fois par compte), `AAAA-MM-JJ` pour `daily_loss`. `kind` / `source` en TEXT. `data` = relevé à la
détection (`limit`, `remaining`, `floor`, `detectedAt`). `failedByIncidentAt` = compte fermé en
confirmant CET incident (seul cas réactivable). `dismissedAt` = retiré, jamais recréé. Seule l'analyse
IA est stockée (`aiAnalysis`, `aiGeneratedAt`) ; chronologie et constats se recalculent. Seed démo :
un incident sur le compte échoué, recréé à chaque seed (cascade). Détails : nestjs.md.

<!-- Origine : tests.md · Autopsie : tests à maintenir (#669) · 2026-10-23 -->
> **Origine** : `tests.md` · « Autopsie : tests à maintenir (#669) » · 2026-10-23

## Autopsie : tests à maintenir (#669)

- API pur : `incident-report.spec.ts` (séance de la maquette, distance, alertes retenues, 3 constats,
  aucun conseil). Service : `account-incidents.service.spec.ts` (démo exclue, unicité, confirmation
  FAILED / ARCHIVED et idempotence, `dismiss` réactivant seulement après confirmation, quota, IA :
  Gratuit verrouillé, démo et `AI_ENABLED` sans appel, `max_tokens` 400). Le Redis du spec est un faux
  EN MÉMOIRE (`fakeRedis` : `SET NX EX`, `EXPIRE`, `INCR`, horloge `advance`) : il prouve la concurrence
  (deux ouvertures simultanées = un appel), le délai après échec ou réponse vide, et le plafond de
  3 essais par jour. `confirmIncident` : seul le corps qui le porte confirme ; formulaire d'édition = rien.
  `@Throttle` de la route : `analysis-throttle.spec.ts` (métadonnées). Vraie base : `account-incidents.int-spec.ts`.
- Démo : `admin/demo-incident.spec.ts` (franchissement au dernier trade, 3 constats, incident et texte
  préenregistré sur la vitrine seulement) ; le faux Prisma de `demo-seed-idempotence.spec.ts` déclare
  `behaviorAlert` et `accountIncident`.
- App : `autopsy.util.spec.ts`, `account-autopsy.component.spec.ts` (vrai template `?raw`, un seul
  appel d'analyse, badge démo par `autopsy-ai-example-badge`, confirmation du retrait, 404, aucune espace
  simple devant `: ; ! ?`), `autopsy.styles.spec.ts` (couleurs et KPI : un `.css?raw` est VIDE sous
  vitest, lire le fichier par `readFileSync`), cas ajoutés à `lost-account-flow.service.spec.ts`,
  `toast.service.spec.ts` et `accounts-lost-account.spec.ts`.
- Un `vi.fn` re-mocké avec une autre valeur doit avoir son retour typé (sinon le typecheck des specs
  échoue en CI) ; une méthode `protected` appelée dans un spec passe par un cast.
