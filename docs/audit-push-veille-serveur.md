# #770 · Notifications push : veille serveur (phase 4 de #666) · plan

> Plan à valider par Greg avant de coder. Branche `feat/770-push-veille-serveur`, partie de
> `origin/dev`. Complète `docs/audit-push-traders.md` (sections 2, 3.1 B et 7.2).

## 1. Ce qui existe

| Brique | Fichier | Rôle pour la veille |
|---|---|---|
| WebSocket Tradovate par user | `integrations/tradovate/tradovate-live.service.ts` | `attach` / `detach` par onglet ; dernier onglet fermé → `stopUser` (WS fermés, bail rendu) |
| Bail « un WS par user » | même fichier, `tradovate:live:<userId>` (TTL 30 s, renouvelé toutes les 10 s) | déjà multi-workers : le titulaire peut ne pas avoir de client |
| Déclenchement des alertes | `tradovate-live.gateway.ts`, `bindEmitter` | prop firm + comportement sur `tradovate:balance`, anti-tilt sur `tradovate:trades` (source `live`). **Indépendant de la présence d'un onglet** : l'émission vers une room vide déclenche quand même les alertes et leur push |
| Push | `push/trader-notifier.service.ts` | filtre démo, appareil, plan, type coupé, heures silencieuses (même pour une alerte forcée), anti-spam |
| Synchro de fond 15 min | `tradovate-background-refresh.cron.ts` | saute les users `isLive` (WS ouvert) : en veille, elle ne doublonne pas |
| Séance | `TradeSession` `ACTIVE`, `activeSessionWhere` (`session/active-session.ts`) | clôturée par l'utilisateur ou par `SessionCloseCron` (17:05 Chicago) |
| Topologie prod | `docker-compose.prod.yml` | `api_blue` / `api_green` en `APP_ROLE=web` (sockets), `worker` (crons). Gateway et adapter Redis présents partout |

Conséquence : la veille ne touche **ni les services d'alertes ni le push**. Tout se joue dans
`TradovateLiveService` : ne pas fermer le WS au dernier `detach` quand le trader est éligible, et
savoir le rouvrir si le process qui le tenait disparaît (déploiement, crash).

## 2. Éligibilité (recalculée à chaque passage)

Un user est en veille si TOUT est vrai :
1. push des traders allumé (`TraderPushService.enabled`) ;
2. pas démo, accès Premium (`isPremiumAccess`, comme les alertes en direct) ;
3. au moins un `UserPushDevice` ;
4. `PROP_RULES` ou `BEHAVIOR` non coupé dans ses réglages ;
5. une séance ouverte (`activeSessionWhere`) ;
6. au moins une connexion Tradovate éligible (`eligible()`, inchangé) ;
7. moins de 10 h depuis le début de la veille.

Pendant ses heures silencieuses, rien ne partirait (même une limite franchie) : la veille reste
inscrite mais le WS est fermé ; il rouvre à la fin des heures silencieuses si la séance est encore
ouverte.

## 3. Mécanisme

**3.1 Registre Redis** `tradovate:watch` (ZSET, membre `userId`, score = fin de veille en ms =
min(début + 10 h, fin de la journée de trading)). Rien en base : état éphémère, comme le bail.

**3.2 Dernier onglet fermé** (`detach`) : si éligible → `ZADD` (score gardé s'il existe déjà, pour
ne pas repousser les 10 h à chaque aller-retour) et **le process garde son WS** (pas de
`stopUser`). Sinon : comportement actuel. Le process titulaire reste titulaire : aucune
reconnexion Tradovate, aucun trou.

**3.3 Balayage** toutes les 30 s, dans chaque process qui porte le gateway (`web` et `all`, pas le
worker de crons) :
- entrées expirées → `ZREM`, et `stopUser` si elles sont tenues ici sans onglet ;
- pour chaque entrée : éligibilité relue (lecture groupée : users, appareils, réglages, séances) ;
  inéligible → retirée du registre et WS fermé là où il tourne sans onglet ;
- entrée éligible sans bail (`EXISTS` en pipeline) → **reprise** : `ensureLive` + rattrapage
  (`catchUp`, même limiteur de concurrence) pour les trades faits pendant le trou. C'est le filet
  après un déploiement blue/green ou un crash : trou ≤ 30 s (bail) + 30 s (balayage).
- Le bail `SET NX` garantit qu'un seul process reprend, même si tous balaient en même temps.

**3.4 Retour dans l'app** : `attach` inchangé. Si un autre process tient le WS en veille, le
nouveau attend le bail comme aujourd'hui ; l'entrée du registre reste (elle couvre la prochaine
fermeture). Les deux cas « titulaire sans onglet, onglet ailleurs » sont déjà gérés par le bail.

**3.5 Fin de veille** : séance clôturée (bouton ou cron 17:05 Chicago), dernier appareil retiré,
type coupé, passage en Free, déconnexion Tradovate, 10 h écoulées → au plus 30 s plus tard. Pas de
branchement dans `SessionService` ni `TraderPushService` (moins de couplage) ; à revoir si Greg veut
un arrêt instantané à la clôture.

**3.6 Déconnexion de l'app** (logout) : le désabonnement de l'appareil (déjà fait, revue #717 m2)
retire l'appareil → inéligible au balayage suivant.

## 4. Comportement des alertes en veille

- **Prop firm** : chemin « direct » (`source: 'live'`) tel quel : journal de séance (#373), incident
  `live` (#669), push. Le marqueur « affichée dans l'app » est posé alors que personne ne l'a vue :
  à la réouverture, l'alerte ne se ré-affiche pas en bandeau. Proposition : accepté (le push l'a
  portée, le journal de séance la garde).
- **Anti-tilt / comportement** : inchangés, ils deviennent enfin utiles app fermée (c'est l'objet
  du ticket). Trades faits pendant un trou de reprise : rattrapés sans anti-tilt (règle actuelle du
  rattrapage).
- **Synchro de fond** : `isLive` vrai en veille → elle saute la séance (le WS la fait) et garde le
  passage horaire du mois. Le relevé `checkFromBackground` ne tourne plus pour ces users : normal,
  le direct le remplace (sans les 15 min de décalage).

## 5. Charge

- Un WS Tradovate en veille coûte ce que coûte aujourd'hui un onglet ouvert : la veille allonge la
  durée, pas le coût unitaire. Population bornée : Premium × appareil abonné × séance ouverte.
- Garde-fou : plafond `TRADOVATE_WATCH_MAX` (défaut 500, par environnement) au-delà duquel une
  nouvelle veille n'est pas ouverte (journalisé en warn, compteur dans le journal du balayage).
- Mesure : banc de `docs/ops/test-charge-vps-prod.md` avec un faux serveur WebSocket Tradovate
  (aucun appel au vrai Tradovate) : 0 · 500 · 1 000 · 2 000 veilles ouvertes, puis le scénario
  k6 habituel → CPU / RAM des conteneurs web et p95. Résultat consigné dans le doc de test de
  charge ; le plafond par défaut en découle.
- Le balayage : 1 `ZRANGE` + lectures groupées toutes les 30 s par process, négligeable.

## 6. Textes (cohérence `plans.md`, 4 points)

- App, `push-settings.component.ts` : « En direct pendant ta séance, même MTC fermé. Hors séance,
  relevé de la synchro automatique, jusqu'à 15 min de décalage. »
- Landing, `Pricing.astro` (2 lignes « app ouverte ») : « pendant ta séance ouverte, même app
  fermée avec les notifications activées ».
- Guard / gating : inchangés (Premium). Cron : synchro de fond inchangée.
- Politique de confidentialité : rien de nouveau (aucune donnée en plus, registre éphémère).

## 7. Étapes (un commit par étape)

1. `tradovate-watch.ts` (pur) : calcul de la fin de veille, éligibilité à partir des lignes lues ;
   tests unitaires (10 h, fin de journée, heures silencieuses à cheval sur minuit, types coupés).
2. `TradovateLiveService` : registre, `detach` qui garde le WS, balayage, reprise + rattrapage,
   plafond ; tests (fermeture → WS gardé ; inéligible → fermé ; reprise après perte du bail ; un
   seul repreneur à deux process ; expiration ; réouverture pendant la veille).
3. Int-spec avec le faux WebSocket (`tradovate-live.int-spec.ts`) : alerte prop firm poussée app
   fermée.
4. Textes app + landing ; agents `nestjs`, `plans`, `deploy` (variable `TRADOVATE_WATCH_MAX`),
   `tests` ; seed démo : rien (démo exclue de la veille).
5. Mesure de charge (section 5), sur feu vert de Greg pour le banc.

Typecheck (`nx run-many -t typecheck`) avant le push ; rien poussé sans « OK push ».

## 8. Choix ouverts · proposition

| # | Question | Proposition |
|---|---|---|
| 1 | Qui tient la veille : le process web qui avait l'onglet, ou le conteneur worker ? | **Web** : aucune passation à la fermeture ; le balayage couvre les déploiements. Le worker (1 process, 1 Go) deviendrait un point unique |
| 2 | Durée max | 10 h, bornée à la fin de la journée de trading |
| 3 | Heures silencieuses | WS fermé pendant, rouvert après si la séance court encore |
| 4 | Arrêt à la clôture de séance | ≤ 30 s par le balayage (pas d'appel depuis `SessionService`) |
| 5 | Bandeau d'alerte à la réouverture | Pas de ré-affichage (le push l'a portée) |
| 6 | Plafond | `TRADOVATE_WATCH_MAX=500` jusqu'à la mesure |
| 7 | Mesure de charge | Sur le banc de test, faux Tradovate, avant activation en prod |
