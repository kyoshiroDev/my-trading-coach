# Bouclier annonces (#670) : plan

> Prévenir le trader quand une position est ouverte, ou s'ouvre, moins de X minutes avant une annonce
> à fort impact des devises de l'actif tradé. Au débrief : ses trades autour des annonces comparés au
> reste. Messages factuels, sans conseil (AMF). Tradovate en lecture seule.
>
> Cadre : branche depuis `origin/dev` et feu vert de push donné par le relecteur (décisions du
> 2026-11-08 et du 2026-11-13). Remplace « worktree depuis beta » et « OK push » du ticket.

## Ce qui existe

| Brique | Où | Ce qu'on en garde |
|---|---|---|
| Détecteurs de comportement | `modules/behavior/behavior-detectors.ts` (`DETECTORS`, `evaluateEntry`) | Nouveau détecteur pur, évalué à chaque **nouvelle entrée** (synchro Tradovate, `tradovate-live.gateway.ts`). |
| Enregistrement + anti-spam | `behavior-alerts.service.ts` (`check`, clé Redis `behavior:spam:…`) | Table `BehaviorAlert`, `type` en texte : nouveau type sans migration. |
| Affichage des alertes de comportement | **aucun** : `BEHAVIOR_ALERTS_UI` éteint, l'app n'écoute pas `behavior:alert` (#671) | Voir le choix C1. |
| Toasts en séance | `prop:alert` / `tilt:alert` → `PropAlertsService` (app) | Canal déjà visible aujourd'hui. |
| Annonces | `EcoEvent` (date + heure de Paris, `currency`, `impact` `high`/`medium`), `classifyEcoEvent` | Seulement `impact = 'high'`. |
| Actif → devises | `assetCurrencies()` (`eco-calendar.briefing.ts`) : NQ, ES, CL, GC, BTC → USD ; 6E → EUR + USD | Réutilisé tel quel, exporté depuis `eco-calendar` (reste dans l'API, pas dans `@mtc/shared`). |
| Positions ouvertes côté serveur | Redis `tradovate:positions:<connId>` (actif, sens, quantité, `at`) | Fraîches seulement si le WebSocket tourne : app ouverte, ou veille serveur #770 (Premium). |
| Débrief | `debriefStats` (`debrief-stats.ts`), trades de la semaine déjà chargés | Stat déterministe, sans IA. |
| Seed démo | `demo-seed.ts` (`seedFakePastRelease` : NFP du vendredi à 14:30) | Un trade NQ à 14:27 ce jour-là. |

## Ce qu'on ajoute

1. **Détecteur `D1_NEWS_WINDOW`** (pur, dans `DETECTORS`) : à l'entrée d'une position, une annonce à
   fort impact d'une devise de l'actif tombe dans les X prochaines minutes.
   Message : « NFP dans 4 min, position ouverte sur NQ. » Plusieurs annonces au même créneau :
   « NFP et taux de chômage dans 4 min, position ouverte sur NQ. » Le nom court vient du libellé
   existant (`classifyEcoEvent`), jamais inventé. Heure de l'annonce : date + heure de Paris converties
   en UTC par le helper existant (`parisWallTimeToUtc`, heure d'été comprise), testé sur la semaine du
   changement d'heure.
2. **Alerte avant l'annonce** (position déjà ouverte) : un passage chaque minute sur le worker cron.
   Pour chaque annonce forte à venir dans X minutes, il lit les positions Redis **fraîches** (moins de
   2 min) des connexions actives sur un actif concerné et produit la même alerte. Exclut `isDemo`, comme
   `check()`. Anti-spam : une seule alerte par compte et par annonce (clé `annonce + compte`, pas par
   type), entrée et tick confondus, par le même pipeline que `check()`. Le worker cron ne tient pas le
   socket du client : l'événement part par l'adaptateur Redis existant (`common/adapters/redis-io.adapter.ts`,
   room par utilisateur), jamais par le callback `emit` du gateway. Le worker dev démarre sans crons :
   ce passage se prouve par des tests unitaires et un int-spec, puis en prod.
3. **Réglage X** : `User.newsShieldMinutes` (`Int?`, migration additive). Null = défaut, 0 = bouclier coupé.
   Réglé dans Profil (préférences de trading).
4. **Stat au débrief** : trades ouverts entre T−X et T+X d'une annonce forte de leurs devises, comparés au
   reste de la semaine : nombre, P&L net, taux de réussite. Bloc « Tes trades autour des annonces ».
   Enregistrée dans `WeeklyDebrief.stats` (Json) : un ancien débrief sans ce champ masque le bloc (jamais
   « 0 »). Fenêtre effective du trader ; bouclier coupé (0) ou non réglé : valeur par défaut (c'est un
   constat, pas une alerte). Aucune IA.
5. **Seed démo** : un trade NQ ouvert à 14:27 le vendredi du NFP, et l'alerte correspondante.
6. **Interrupteur** `NEWS_SHIELD_ENABLED` (coupe-circuit dans `env.ts`), obligatoire : C1 contourne
   `BEHAVIOR_ALERTS_UI`, c'est le seul moyen de couper le bouclier. Son état par défaut en prod revient à Greg.

## Choix ouverts et recommandations

| # | Choix | Recommandation |
|---|---|---|
| C1 | **Où le trader voit l'alerte** (**Greg**) : les alertes de comportement ne sont affichées nulle part tant que #671 n'est pas fait. | Émettre le bouclier par le canal déjà visible (toast en séance, comme `tilt:alert`), indépendamment de `BEHAVIOR_ALERTS_UI`, et l'enregistrer aussi dans `BehaviorAlert` pour que #671 le reprenne. Sinon la feature ne se voit pas. |
| C2 | **Seuil X par défaut** | **5 minutes**, réglable de 1 à 30 (0 = coupé). Fenêtre courte et lisible. |
| C3 | **Fenêtre de la stat au débrief** | De X min avant à X min après l'heure de l'annonce (le mouvement continue après la publication). **Tranché par le relecteur.** |
| C4 | **Gratuit ou Premium** (**Greg**) | Alerte en séance **gratuite** pour tous : c'est une protection, au cœur de la promesse « tenir ses règles sous pression ». App fermée, l'alerte n'existe que via la veille serveur, déjà Premium. Stat au débrief : suit le Weekly Debrief, déjà Premium. Précédent : l'anti-tilt en direct est Premium. Si Greg préfère Premium, la règle des 4 points de `plans.md` s'applique. |
| C5 | **Push app fermée** (**Greg**, avec C1) | Oui, par le push trader existant (`TraderNotifier`, catégorie comportement), seulement là où il est allumé. Écart assumé à la décision #602 (« push jamais en phase silencieuse ») pour ce seul détecteur. |
| C6 | **Mise en route** (**Greg** pour la prod) | Interrupteur `NEWS_SHIELD_ENABLED` : allumé d'abord sur dev, puis en prod sur le feu vert de Greg. |
| C7 | **Lien avec #667** (contrat de session) | Ticket gardé à part, commentaire « lié à #667 » sur #670 ; le contrat pourra reprendre le seuil plus tard. **Tranché par le relecteur.** |

## Étapes (une PR vers `dev`, un commit par étape)

1. API : détecteur `D1_NEWS_WINDOW` (pur) + tests, mapping actif → devises exporté depuis `eco-calendar`, interrupteur `NEWS_SHIELD_ENABLED`.
2. API : passage chaque minute « avant l'annonce » + anti-spam par annonce + tests.
3. Prisma : `User.newsShieldMinutes` (migration additive) + DTO du profil.
4. App : toast en séance, réglage dans Profil (390 px d'abord), tests.
5. API + app : stat du débrief + affichage, tests.
6. Seed démo : trade NQ à 14:27 le vendredi du NFP + alerte.
7. Références (`behavior`, débrief, démo) et captures 390 / 1440.

## Vérificateurs prévus

nestjs et tests (API) ; security (cron qui cible des utilisateurs, préférence du profil) ; prisma et
security (migration) ; prisma et nestjs (seed démo) ; angular, design et tests (Profil, toast, débrief) ;
plans (gating) ; relecteur (texte des alertes), toujours en dernier.
