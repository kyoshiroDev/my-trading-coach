# Audit #671 : alertes de comportement, phase 2 (affichage)

> Plan court, écrit en lecture seule sur `origin/dev` (`5c92c16b`, 2026-11-28).
> Tout reste derrière `BEHAVIOR_ALERTS_UI` (vrai seulement si la valeur est `true`, absente = éteint). Une seule PR.
> Hors périmètre : les points 4 (seuils, rejeu) et 7 (flag beta puis prod). Aucun fichier supprimé : `tilt-detection.ts` et `tilt-alerts.service.ts` restent en place.

## 0. Ce que le code fait déjà (à garder en tête)

- `BehaviorAlertsService.check` (`apps/api-mytradingcoach/src/modules/behavior/behavior-alerts.service.ts:87`) enregistre l'alerte, puis, si `behaviorAlertsUiEnabled()` (l.37), envoie `emit('behavior:alert', …)` et `notifier.notify(userId, 'BEHAVIOR', TRADER_PUSH_MESSAGES.behavior(...))`. **Le plan de l'utilisateur n'est jamais vérifié.** Si on allume le flag tel quel, un compte gratuit reçoit l'événement socket. Le push, lui, est déjà filtré : `PUSH_PREMIUM_TYPES` contient `BEHAVIOR` (`libs/shared/src/contracts/push.ts:13`).
- `onStopMoved` (E1, l.166) envoie le socket **sans push**. Il n'a pas non plus de contrôle Premium.
- `BehaviorAlert.mutedByUser Boolean @default(false)` et `dismissedAt` existent déjà (`prisma/schema.prisma:926-927`). Ils ont été prévus pour cette phase.
- D1 passe par `news:alert`, donc par le toast `PropAlertsService.handleNews`, hors flag. Il ne doit pas entrer dans le bandeau.
- `TiltAlertsService.check` (`modules/integrations/tradovate/tilt-alerts.service.ts`) est réservé au Premium (`isPremiumAccess`). Il fait trois choses : `emit('tilt:alert')`, un push `BEHAVIOR` et `journal.recordEvent(..., 'tilt', ...)`. Ce journal alimente le récap, le débrief IA et l'autopsie.
- `CreateTradeDto.emotion` est **déjà optionnel et nullable** (`modules/trades/dto/create-trade.dto.ts:75-77`, `@IsEnum @IsOptional`). Une émotion absente hérite de `TradeSession.moodStart`, et `Trade.emotion` est nullable. **Le DTO n'impose donc rien.**
- `JwtAuthGuard` est global (`app.module.ts:126`), `DemoReadOnlyGuard` aussi. Le Premium se pose par `@UseGuards(JwtAuthGuard, PremiumGuard)` sur la classe, comme dans `DebriefController`.

## (a) Fichiers à créer ou modifier

### libs/shared
| Fichier | Changement |
|---|---|
| `libs/shared/src/contracts/behavior.ts` (nouveau) | `BehaviorAlertType` et `BehaviorAlertSeverity` déplacés ici depuis `behavior-detectors.ts`, qui les réexporte pour ne casser aucun import API. `BEHAVIOR_MUTABLE_DETECTORS` = A1, A2, A3, B, C1, C2, C3, E1 (D1 exclu, il a son propre réglage `newsShieldMinutes`). `BEHAVIOR_DETECTOR_LABELS` (libellés FR pour le Profil et le débrief). Interfaces : `BehaviorAlertEvent` (payload socket : `id, accountId, type, severity, message, context`), `BehaviorConfig { uiEnabled: boolean }`, `BehaviorMute { detector, createdAt }`, `BehaviorAlertHistoryItem { id, accountId, type, severity, message, createdAt, mutedByUser, after: { count, pnl } }`. |
| `libs/shared/src/contracts/index.ts` | `export * from './behavior';` |

### Prisma
| Fichier | Changement |
|---|---|
| `prisma/schema.prisma` | Ajouter le modèle `BehaviorDetectorMute` (voir d) et la relation inverse `behaviorDetectorMutes BehaviorDetectorMute[]` sur `User`, à côté de `behaviorAlerts` (l.162). |
| `prisma/migrations/20261128120000_behavior_detector_mute/migration.sql` (nouveau) | `CREATE TABLE` et clé étrangère en cascade, sur le modèle de `20261018120000_behavior_baseline`. |

### API (`apps/api-mytradingcoach/src/modules/`)
| Fichier | Changement |
|---|---|
| `behavior/behavior-alerts.service.ts` | Nouveau helper privé `deliver(userId, accountId, draft, emit)`, appelé par `check` et `onStopMoved` avant l'insert. Il lit **une seule fois par appel** le plan (`plan, role, trialEndsAt`, ajoutés au `select` de `check` l.90 et de `onStopMoved` l.178) et les détecteurs coupés (`behaviorDetectorMute.findMany({ where: { userId }, select: { detector: true } })`). L'insert de `behaviorAlert.create` reçoit `mutedByUser: muted`. Le socket et le push partent seulement si `behaviorAlertsUiEnabled() && isPremiumAccess(user) && !muted`. E1 reçoit le push par ce même chemin (aujourd'hui il n'en a pas). Les clés anti-spam ne changent pas. |
| `behavior/behavior-mutes.service.ts` (nouveau) | `list(userId)`, `mute(userId, detector)` (upsert idempotent), `unmute(userId, detector)` (`deleteMany`, idempotent). |
| `behavior/behavior-history.ts` (nouveau, pur) | `alertAftermath(alerts, trades)`. Pour chaque alerte : les trades clôturés du même compte, avec `tradedAt > createdAt`, dans la même journée CME (`tradingDay`), **jusqu'à l'alerte suivante du même compte** pour ne pas compter deux fois un trade. Renvoie `{ count, pnl }`, avec le P&L calculé par `netPnl` (`libs/shared/src/trade-stats.ts:41`), sans conversion de devise. |
| `behavior/behavior-history.service.ts` (nouveau) | `list(userId, from, to)` : alertes (index `userId, createdAt` existant), puis trades `{ userId, accountId in, pnl not null, tradedAt in [from, fin de journée(to)+1 j] }`, puis `alertAftermath`. Les alertes sur un compte perdu restent affichées : ce sont les données du trader, ventilées par compte, pas un agrégat. À confirmer avec `compte-perdu.md`. Les types de pur signal (F1, voir plus bas) sont exclus. |
| `behavior/behavior-emotion.ts` (nouveau, pur) et constante `F1_AFTER_LOSS_MS` dans `behavior.constants.ts` | `emotionAfterLossDraft(emotion, lastClosed, at)` : `REVENGE` ou `FEAR` saisi moins de N minutes (proposé : 15) après un trade perdant du même compte, dans la même journée. Type `F1_EMOTION_AFTER_LOSS`, gravité `medium`. |
| `behavior/behavior-signals.service.ts` (nouveau) | `recordEmotionAfterLoss(userId, trade)` en best-effort : insère un `BehaviorAlert` de type F1, **jamais émis**, quel que soit le flag. Il n'entre dans aucun seuil (aucune lecture par les détecteurs). |
| `behavior/behavior.controller.ts` (nouveau) et `behavior/dto/mute-detector.dto.ts`, `behavior/dto/behavior-alerts-query.dto.ts` | Routes, voir (c). |
| `behavior/behavior-ui.guard.ts` (nouveau) | Renvoie 404 si `!behaviorAlertsUiEnabled()`. Posé sur les routes de mutes et d'historique, pas sur `/config`. |
| `behavior/behavior.module.ts` | Ajouter le contrôleur et les trois services. Exporter `BehaviorSignalsService`. |
| `integrations/tradovate/tilt-alerts.service.ts` | Dans la boucle `for (const f of findings)` : si `behaviorAlertsUiEnabled()`, **ni `emit` ni `notifier.notify`**, mais `journal.recordEvent` est conservé (le contexte IA et l'autopsie ne perdent rien). Flag faux : comportement inchangé. La clé Redis `tilt-alert:` reste posée dans les deux cas. |
| `trades/trades.service.ts` (`create`, l.72) | Après `prisma.trade.create`, si la source est `MANUAL` et que `dto.emotion` vaut `REVENGE` ou `FEAR` : `void this.signals?.recordEmotionAfterLoss(...)` (`@Optional`, jamais bloquant). |
| `trades/trades.module.ts` | Importer `BehaviorModule`. Pas de cycle : `BehaviorModule` importe seulement `AccountsModule` et `TraderPushModule`. |
| `admin/demo-data/behavior-alerts-example.ts` (nouveau, pur) et `.spec.ts` | Deux ou trois alertes passées sur l'Apex, dans la semaine du débrief démo : `B_REVENGE` en `medium` (ambre) et `C1_LOSS_STREAK` en `high` (rouge), datées juste avant des trades perdants, plus un mute `C2_OVER_DAILY_LIMIT`. Les messages suivent exactement le format des détecteurs (vérifié par la spec). |
| `admin/demo-seed.ts` (`seedTradingData`, purge l.99-104, alertes l.204-230) | Purge `behaviorDetectorMute.deleteMany({ where: { userId } })`. Les alertes partent déjà en cascade avec les comptes. Ensuite, création des exemples et du mute. D1 (high) et E1 (medium) existent déjà. |

Specs API : `behavior-alerts.service.spec.ts` (flag éteint : rien d'émis ; flag allumé et gratuit : rien d'émis ; Premium : émission et push ; détecteur coupé : `mutedByUser: true`, ni socket ni push ; E1 sur les mêmes cas). `tilt-alerts.service.spec.ts` (flag allumé : ni `emit` ni `notify`, journal appelé ; flag éteint : inchangé). `behavior-history.spec.ts`, `behavior-emotion.spec.ts`, `behavior-mutes.service.spec.ts`. `behavior.controller.int-spec.ts` (`createIntegrationApp`) : gratuit = 403, démo POST = 403, flag éteint = 404. Horloge figée partout.

### Front (`apps/app-mytradingcoach/src/app/`)
| Fichier | Changement |
|---|---|
| `core/api/behavior.api.ts` (nouveau) | `getConfig()`, `getMutes()`, `mute(detector)`, `unmute(detector)`, `getAlerts(from, to)`. |
| `core/stores/behavior-alerts.store.ts` (nouveau, `providedIn: 'root'`) | `uiEnabled` (chargé par `/behavior/config` après login), `alerts` (alertes de la séance, en mémoire), `push(e)`, `removeType(type)`, `dismiss()`, `tone` en `computed`. |
| `core/services/tradovate-live-socket.service.ts` (`connect`, l.84-89) | `socket.on('behavior:alert', (e: BehaviorAlertEvent) => this.behaviorAlerts.push(e))`. Le store ignore l'événement si `!uiEnabled()`. Le son passe par `AlertSoundService` (`warning`, ou `critical` en rouge). |
| `features/dashboard/components/session-live/components/live-behavior-alert/live-behavior-alert.component.{ts,html,css}` et `.util.ts` (`behaviorTone`) avec leurs specs (nouveaux) | Le bandeau, voir (e). Il contient la phrase serveur, le compte s'il diffère de celui de la séance, le bouton « Pas pour mon style » (`data-testid="behavior-mute"`) et « Fermer » (`behavior-dismiss`, local). Annonce : deux zones `aria-live` persistantes et invisibles à côté du bandeau (`polite` pour l'ambre, `assertive` pour le rouge) ; le bandeau visible n'a pas de `role` d'annonce. Conçu d'abord à 390 px : bouton de 44 px, `min-width: 0`, texte qui passe à la ligne. |
| `features/dashboard/components/session-live/session-live.component.{html,ts}` | Insérer `<mtc-live-behavior-alert>` en tête de `.lv-body` (juste après `<mtc-live-bar>`), seulement si `uiEnabled()`. Pour un compte gratuit avec le flag allumé : `<mtc-premium-lock heading="Alertes de comportement">` (petit teaser). |
| `features/dashboard/components/session-live/components/quick-trade/quick-trade.component.{ts,html}` | `qtEmotion = signal<EmotionState \| null>(null)` (l.68). Un second clic désélectionne. Dans `emitTrade` (l.316), `...(this.qtEmotion() ? { emotion: this.qtEmotion()! } : {})`, puis remise à `null` après l'envoi. Nouvelle spec `quick-trade-emotion.spec.ts`. |
| `features/weekly-debrief/debrief-behavior-alerts.component.{ts,css}` (nouveau, sur le modèle de `debrief-emotions.component.ts`) et `debrief.component.html` (près du bloc `newsWindow`, l.185) | Si `uiEnabled()`, liste « Alertes de la semaine » : pastille ambre ou rouge selon la gravité, libellé du détecteur, message, heure, puis « n trades ensuite · P&L » avec `pnlFormat : null : accountId` (#947). Bloc masqué s'il n'y a aucune alerte. `mtc-error-state` en cas d'échec. Le débrief entier étant déjà Premium, pas de teaser ici. |
| `features/profile/behavior-mutes/behavior-mutes.component.{ts,html,css}` (nouveau) et `profile.component.html` (une `settings-section` près de « Préférences », l.598) | Si `uiEnabled()` : liste des détecteurs coupés avec « Réactiver » (`behavior-unmute-<type>`), ou état vide. Teaser `mtc-premium-lock` pour un compte gratuit. Démo : visible, bouton bloqué (403 affiché). On ne l'ajoute pas dans `profile.component.ts`, déjà long de 871 lignes. |

### Docs et références (dernier commit)
- `docs/audit-alertes-comportement.md` (ce plan).
- `.claude/reference/commun/detecteurs-comportement.md` : nouvelle section « Phase 2 (#671) ».
- `.claude/reference/plans/gating-detail.md` : alertes, historique et préférence en Premium ; anti-tilt remplacé quand le flag est allumé.
- `.claude/agents/design.md` : ligne du tableau des couleurs, rouge pour un bandeau comportement aggravé, choix produit daté comme pour « annonce impact fort ».
- `.claude/decisions.md` : décisions de Greg.

## (b) Ordre des étapes (un commit par étape)

1. `feat(shared): contrat des alertes de comportement` (`contracts/behavior.ts`, déplacement du type, réexport).
2. `feat(prisma): table BehaviorDetectorMute` (schéma et migration).
3. `feat(behavior): préférence « pas pour mon style » et config` (service mutes, contrôleur `/behavior`, garde du flag, DTO, int-spec).
4. `feat(behavior): envoi réservé au Premium, détecteurs coupés en silence` (`deliver` dans `BehaviorAlertsService`, push E1, specs).
5. `feat(behavior): anti-tilt muet quand le moteur s'affiche` (`TiltAlertsService` et spec des deux cas).
6. `feat(behavior): historique des alertes et ce qui a suivi` (pur, service, route, specs).
7. `feat(behavior): émotion après une perte enregistrée comme signal` (pur, service, branchement dans `TradesService.create`).
8. `feat(app): bandeau d'alerte dans la Session live` (api, store, écoute socket, composant, teaser, captures 390 et 1440).
9. `feat(app): trade rapide sans émotion présélectionnée`.
10. `feat(app): alertes au débrief et détecteurs coupés dans le Profil`.
11. `feat(demo): alertes passées et détecteur coupé dans le seed`.
12. `docs(behavior): phase 2, références et décisions`.

Typecheck (`nx run-many -t typecheck`, specs comprises) après chaque étape.

## (c) Routes API

Toutes sous `BehaviorController` (`@Controller('behavior')`). `JwtAuthGuard` est global ; les mutations sont bloquées en démo par `DemoReadOnlyGuard`, sans rien ajouter.

| Méthode | Chemin | Guards | DTO / réponse |
|---|---|---|---|
| GET | `/behavior/config` | Jwt (global) seulement, pour qu'un compte gratuit voie le teaser | → `BehaviorConfig { uiEnabled }` |
| GET | `/behavior/mutes` | `PremiumGuard`, `BehaviorUiGuard` | → `BehaviorMute[]` |
| POST | `/behavior/mutes` | `PremiumGuard`, `BehaviorUiGuard` | `MuteDetectorDto { @IsIn(BEHAVIOR_MUTABLE_DETECTORS) detector: string }` → `BehaviorMute` (upsert, 201) |
| DELETE | `/behavior/mutes/:detector` | `PremiumGuard`, `BehaviorUiGuard` | paramètre vérifié contre `BEHAVIOR_MUTABLE_DETECTORS` (400 sinon) ; 204 idempotent |
| GET | `/behavior/alerts?from=YYYY-MM-DD&to=YYYY-MM-DD` | `PremiumGuard`, `BehaviorUiGuard` | `BehaviorAlertsQueryDto` (`@IsDateString`, intervalle de 31 jours max) → `BehaviorAlertHistoryItem[]` ; le front passe `startDate` et `endDate` du débrief affiché |

**Pourquoi `/behavior/config` plutôt que `/auth/me` :** `profile.component.ts` (l.530, 647, 725) et `onboarding.component.ts:534` font `auth.setCurrentUser(res.data)` avec la réponse de `UsersService`, qui a son propre `select` (`users.service.ts:63`). Un champ ajouté seulement dans `toMe` disparaîtrait donc après chaque modification du profil, jusqu'au prochain poll de `/auth/me`. Si le relecteur préfère `/auth/me`, il faut ajouter `behaviorAlertsUi` dans `toMe` (`auth.service.ts:106`) **et** dans la réponse de `UsersService`, ou fusionner côté front.

## (d) Schéma Prisma

Migration : `20261128120000_behavior_detector_mute`.

```prisma
/// Détecteur de comportement coupé par le trader (« Pas pour mon style », #671). L'alerte reste
/// enregistrée (`BehaviorAlert.mutedByUser = true`), seuls le socket et le push sont coupés.
model BehaviorDetectorMute {
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// `BehaviorAlertType` sauf `D1_NEWS_WINDOW` (TEXT, comme `BehaviorAlert.type`).
  detector  String
  createdAt DateTime @default(now())

  @@id([userId, detector])
}
```

`@@id([userId, detector])` porte l'unicité demandée et sert de clé primaire, comme `@@id([date, model])` existant (l.1153). Si le relecteur veut une colonne `id` : `id String @id @default(cuid())` plus `@@unique([userId, detector])`. Additive, sans index en plus : la clé primaire couvre la lecture par `userId`.

```sql
CREATE TABLE "BehaviorDetectorMute" (
  "userId" TEXT NOT NULL,
  "detector" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BehaviorDetectorMute_pkey" PRIMARY KEY ("userId","detector")
);
ALTER TABLE "BehaviorDetectorMute" ADD CONSTRAINT "BehaviorDetectorMute_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

## (e) Gravité et couleurs, règle « rouge si ça s'aggrave »

- **Correspondance** : `medium` donne ambre (`--yellow`, `--yellow-dim`), `high` donne rouge (`--red`, `--red-dim`). Gravités actuelles (`behavior-detectors.ts`) :
  - A1, C1 et C3 sont toujours `high`.
  - C2 et E1 sont toujours `medium`. E1 reste `medium`, le point 4 est hors périmètre.
  - A2 passe en `high` quand il reste au plus `threshold × A2_HIGH_FRACTION` points avant la perte max.
  - A3 passe en `high` à partir de 80 % de la perte max consommée.
  - B passe en `high` à partir de `B_HIGH_SIGNALS` (3) signaux.
  - D1 est `high`, mais il ne passe pas par le bandeau.
- **L'aggravation est donc déjà codée en partie par les détecteurs**, à l'intérieur de chacun.
- **Règle du bandeau** (`behaviorTone(alerts, now)`, fonction pure avec spec) : rouge si la dernière alerte est `high`, **ou** si une autre alerte non fermée du même compte est arrivée dans la séance au cours des 30 dernières minutes (deux signaux différents rapprochés). Ambre sinon. La constante est à fixer dans le fichier util.
- On affiche une seule phrase, celle de la dernière alerte ; le compteur « 2e signal » reste discret. Fermer le bandeau remet l'état à zéro.
- **Limite** : l'état vit en mémoire. Après un rechargement, le bandeau repart vide (il est alimenté par le socket seulement). Pour le restaurer, il faudrait un `GET /behavior/alerts` sur la journée au montage : en option, non prévu.
- **Design** : `design.md` réserve `--red` aux pertes. Il faut une exception datée dans le tableau, comme pour « annonce impact fort », et l'accord du vérificateur design.

## (f) Points à vérifier et risques

1. **DTO émotion** : déjà optionnel et nullable, aucun changement API. Sans émotion, le trade hérite de `moodStart` à la lecture : c'est voulu. « Dernière émotion saisie » est écartée parce qu'elle reproduit le biais.
2. **Lecture de `BEHAVIOR_ALERTS_UI`** : une seule source, `behaviorAlertsUiEnabled()` (`behavior-alerts.service.ts:37`), utilisée par `BehaviorAlertsService`, `TiltAlertsService`, `BehaviorUiGuard` et `/behavior/config`. Le front ne lit jamais l'environnement, seulement `/behavior/config`. `TiltAlertsService` importe une fonction pure depuis un fichier de service. Si le vérificateur nestjs n'en veut pas, la déplacer dans `behavior-flags.ts`.
3. **Gating** : aujourd'hui `behavior:alert` partirait vers un compte gratuit dès le flag allumé. Le contrôle Premium dans `deliver` est **bloquant** pour la PR. Il faut vérifier la cohérence aux 4 points de `plans` : `PLAN_BENEFITS.anti_tilt` (`libs/shared/src/plan-benefits.ts:37`) décrit les trois signaux de #371 : pour qu'il reste vrai flag allumé, l'anti-tilt garde son signal de surtrading relatif quand le trader n'a pas déclaré `tradesPerDayMax` (C2 ne couvre que la limite déclarée) ; texte à faire valider par Greg sans le modifier ici. Le texte de la landing n'est pas touché.
4. **Push #666** : il passe déjà par `TraderNotifier`, avec filtre Premium, coupure par l'utilisateur, heures calmes et anti-doublon de 15 min. Le type `BEHAVIOR` est partagé par l'anti-tilt et le moteur, et les deux ne poussent jamais en même temps. Nouveau : push E1 (aujourd'hui absent). Un détecteur coupé ne pousse plus.
5. **Double alerte** : flag allumé, l'anti-tilt se tait (socket et push) et le moteur parle, sauf le surtrading sans limite déclarée (voir 3). Flag éteint, l'inverse. Le journal `tilt` reste écrit dans les deux cas, ce n'est pas une alerte visible. D1 reste sur son toast `news:alert` et n'entre pas dans le bandeau, donc pas de doublon. D1 ne peut pas non plus être coupé par « Pas pour mon style » : il a son propre réglage dans le Profil.
6. **E1** : déclenché par `onStopMoved`, hors `check`. Il passe par le même `deliver` (Premium, coupure, push). La gravité reste `medium`.
7. **Signal émotion F1** : nouveau type TEXT, jamais émis, exclu de l'historique et de tout détecteur. Le trade rapide ne sert qu'aux saisies manuelles, donc aucun impact sur la synchro. À valider : la fenêtre de 15 min, et l'enregistrement dans `BehaviorAlert` plutôt que dans une table de signaux.
8. **Démo** : le socket refuse `isDemo` (`tradovate-live.gateway.ts`, `authenticate`), donc pas de bandeau en démo. Seuls l'historique et le Profil y sont visibles. Le flag doit être allumé sur l'environnement de la démo pour que ces blocs apparaissent.
9. **Conservation** : `BehaviorAlert` n'est pas dans `RETENTION_RULES` (`retention/retention.cron.ts:13`). Le ticket #602 demande de trancher avant la phase 2 : point pour Greg.
10. **Historique** : « ce qui a suivi » s'arrête à l'alerte suivante du même compte, ou à la fin de la journée CME. Il ne compte que les trades clôturés (`tradedAt` = clôture pour un trade synchronisé). Le P&L est net, dans la devise du compte, sans total toutes devises confondues (#947).
11. **Autopsie #669** (`account-incidents.service.ts:370`) : elle lit toutes les alertes du compte et du jour, y compris celles d'un détecteur coupé. C'est voulu (enregistrées), à confirmer.

## Choix ouverts pour Greg (avec la réponse proposée)
- Gating : alertes, historique et préférence en Premium ; teaser pour un compte gratuit. **Proposé : oui.**
- Émotion par défaut au trade rapide : **aucune.**
- Gravité E1 : **`medium`** tant que les seuils ne sont pas revus.
- Fenêtre « aggravation » du bandeau : **30 min**. Fenêtre F1 : **15 min**.
- Conservation de `BehaviorAlert` : à décider.

## Décisions du relecteur après la maquette (2026-11-28)

- Exception `--red` datée dans `design.md` et `decisions.md` (bandeau de gravité haute, pastille au Débrief), gravité jamais portée par la couleur seule.
- Annonce : deux zones `aria-live` persistantes (polite / assertive), aucun `role` sur le bandeau visible.
- Messages des détecteurs corrigés au serveur (espace insécable avant « : » et « % », « 11ᵉ », apostrophe ’).
- `GET /behavior/config` retenu (pas `/auth/me`), int-spec 401 sans jeton.
- Signal `F1_EMOTION_AFTER_LOSS` : liste `BEHAVIOR_SIGNAL_TYPES` (contrat partagé) exclue de l'historique, de l'autopsie (#669, `account-incidents.service.ts`), de la référence, du rejeu, des détecteurs et de l'anti-spam ; spec dédiée. Remplace le point (f)11 ci-dessus.
- Conservation de `BehaviorAlert` : hors PR (#1338).
- Bandeau collant dans le même bloc que `mtc-live-bar` (pas de `top` figé) ; `mtc-premium-lock` et `mtc-error-state` utilisés tels quels.
