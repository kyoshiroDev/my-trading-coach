# Démo : bandeau d'inscription et campagnes de test (#1029)

> Contenu déplacé à l'identique depuis `.claude/agents/angular.md`, `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Campagnes de test exclues de l'admin Acquisition (#1029, nov. 2026) · 2026-11-15 -->
> **Origine** : `nestjs.md` · « Campagnes de test exclues de l'admin Acquisition (#1029, nov. 2026) » · 2026-11-15

## Campagnes de test exclues de l'admin Acquisition (#1029, nov. 2026)

- **Une seule liste** : `TEST_ACQUISITION_PATTERNS` (`libs/shared/src/test-acquisition.ts`) =
  `test`, `test-*`, `ami`, appliquée à la source, au medium ET à la campagne, sans casse. Motif sans
  `*` = valeur exacte, `*` final = préfixe ; jamais « contient » (`contest`, `latest-promo`, `miami`,
  `amis-trading` restent). Ajouter une campagne de test = un motif ici + une ligne dans
  `.claude/decisions.md`.
- SQL : `common/stats/test-acquisition.ts`. `notTestAcquisitionSql` (`LOWER(COALESCE(col,'')) LIKE ANY
  (ARRAY[…])`, motifs passés par `testPatternToLike` : `\`, `_`, `%` échappés) ;
  `acquisitionUsersSql(includeTests)` = `realUsersSql` + hors campagne de test, ou `"isDemo" = false`
  seul avec les tests (internes et ADMIN compris, **la démo toujours exclue**) ;
  `anonymousAcquisitionSql(includeTests)` pour `LandingVisitDaily` / `FunnelEventDaily`.
  Propre à Acquisition : les autres pages gardent `realUsersSql()`.
- Les 5 routes de la page (`/admin/acquisition`, `/funnel`, `/signup-funnel`, `/landing-engagement`,
  `/signup-methods`) prennent `?includeTests=true|1` (`AcquisitionQueryDto`,
  `AcquisitionPeriodQueryDto` avec `days`) ; absent = tests exclus. Rien n'est supprimé en base.
  Vérifié sur une vraie base : `common/stats/test-acquisition.int-spec.ts`.
- **Limite** : les `register_success` anonymes envoyés sans UTM par des tests passés ne sont pas
  filtrables (aucune jointure User). L'admin affiche à côté le nombre de comptes créés (`funnel.signups`).
  Pour tester : ouvrir l'app avec `?internal=1` avant (plus rien n'est envoyé).

<!-- Origine : angular.md · Démo : bandeau d'inscription (#1029, nov. 2026) · 2026-11-15 -->
> **Origine** : `angular.md` · « Démo : bandeau d'inscription (#1029, nov. 2026) » · 2026-11-15

## Démo : bandeau d'inscription (#1029, nov. 2026)

`shared/components/demo-cta/` (`mtc-demo-cta`), monté par le shell (`sidebar.component.html`, fin de
`<main>`) seulement si `userStore.isDemo()`. **Seul** bouton « Créer mon compte » de la démo :
- **Bandeau** collé en bas de la zone de contenu (`position: sticky; bottom: 0` dans `.main-content`
  en colonne flex, `margin-top: auto`) : visible en bas pendant le défilement, rangé APRÈS le contenu
  en fin de page, donc jamais par-dessus un bouton. Texte sur 3 lignes « Ça te parle ? Crée ton compte » /
  « **{N} jours de Premium offerts** » / « sans carte », N = `PREMIUM_SIGNUP_TRIAL_DAYS`. Aucun prix,
  aucune promesse de gain.
- **Téléphone + bouton « + » flottant** (journal… ; `styles.css`, #631 : `padding-bottom: 92px` sur
  `.main-content`) : en démo ce padding passe à 0 (sinon le sticky s'accroche 92 px au-dessus du bas),
  le « + » remonte à `var(--demo-cta-h) + 16px`, et `.demo-cta-fab-space` (80 px, juste avant le
  bandeau) garde la fin de page visible. Mesuré à 390 px : bandeau à 772 px, « + » 700-756, fin du
  contenu 692.
- **Texte sur 3 lignes, une phrase chacune** (#1041) : « Ça te parle ? Crée ton compte » /
  « {N} jours de Premium offerts » (gras) / « sans carte » (`.demo-cta-line` en bloc). Hauteurs :
  64 px sur ordinateur (texte 53 px), 72 px sur téléphone (texte 12 px, 45-47 px de 320 à 768 px) ;
  sous 400 px le bouton « Créer mon compte » passe sur 2 lignes (84 px), sinon la 1re phrase
  repasse à la ligne dès 375 px ; 11,5 px sous 340 px. Mesuré en prod avec les vraies polices.
- Bandeau « Mode démo » du haut : teinte posée sur `var(--bg)` (fond plein, #1041), le contenu ne
  se voit plus à travers. Badge « interne » (`?internal=1`) : remonté au-dessus du bandeau du bas
  en démo (`styles.css`, `body:has(.main-content.has-demo-cta) .internal-badge`).
- **Croix** → pastille « Créer mon compte » à droite (rangée transparente, clics laissés au contenu) ;
  le bandeau revient en grand au `NavigationEnd` suivant.
- **Relance unique** (`demo-cta.util.ts`, `relanceDue`) : après 60 s depuis l'arrivée (horodatage en
  sessionStorage, un rechargement ne remet pas à zéro) OU 3 pages vues (URL distinctes sans
  paramètres, `/demo` exclue ; la page de création du bandeau compte une fois même s'il naît
  pendant la navigation), une fois par visite (sessionStorage `mtc_demo_relance`). Repoussée tant
  qu'un défilement a eu lieu dans les 1,5 s, qu'un champ a le focus (`isTypingTarget`) ou qu'une
  autre fenêtre `aria-modal` est ouverte. Focus sur « Continuer la démo », Échap ferme (`mtcDialog`).
  Le smoke E2E (3 pages) l'ouvre sans cliquer ; un futur E2E qui clique après 3 pages ou 60 s doit
  poser `sessionStorage.mtc_demo_relance = '1'` avant.
- **Action bloquée** (403 « mode démo » → `DemoService.promptSignup()`) : fenêtre rendue par ce
  composant (plus par la sidebar), même lien, placement `action`.
- **Lien** : `DemoService.registerUrl()` = `/register?` + `demoRegisterParams` (`@mtc/shared`) : UTM
  et `ref` retenus à l'arrivée sur `/demo` (`DemoEntryComponent` → `captureOrigin`, sessionStorage
  `mtc_demo_origin`), `utm_source=demo` seulement sans UTM, `source=demo` toujours. Clic : événement,
  puis `AuthService.endDemoSession()` (jeton démo effacé sans appel API ni redirection /login) et
  navigation DANS l'app (la requête d'événement n'est pas coupée). Ctrl/Cmd/clic milieu : nouvel
  onglet, la démo reste. `RegisterComponent` passe `source=demo` en `entry` à `SignupFunnelService`
  → `detail: 'demo'` sur `register_view/submit/success` (jamais le champ `entry` envoyé) ; le script
  `register_view` d'`index.html` fait de même.
- **Événements** (`ProductEventsService`) : `demo_cta_view` (une fois par visite, `banner`),
  `demo_cta_click` (`place` = `banner|pill|modal|action`, `DEMO_CTA_PLACEMENTS`), `demo_modal_shown`
  (place = écran). `demo_signup_click` n'est plus émis.
- **Mode interne** : `DemoEntryComponent` envoie `{ internal: true }` à `demo-login` quand
  `SignupFunnelService.internal()` : l'ouverture n'est pas comptée.
- Tests : `demo-cta.component.spec.ts` (bandeau, pastille, relance 60 s / 3 pages, saisie, défilement,
  action bloquée), `demo.service.spec.ts`, `signup-funnel.service.spec.ts`.
