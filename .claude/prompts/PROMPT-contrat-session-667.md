# PROMPT-contrat-session-667 : contrat de session

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #667 : Contrat de session : les règles que le trader se fixe

## Pourquoi
Les seuils génériques se trompent de trader : un scalper qui enchaîne 15 trades n'est pas en tilt, un swing trader qui en fait 4 l'est peut-être. Comparer le trader à ses propres engagements, pris à froid avant la séance, est plus juste et plus difficile à contester. Les limites de la firm protègent le compte ; le contrat protège le trader de lui-même, avant d'arriver à ces limites.

## Ce que ça fait
- En pré-session, le trader fixe ses limites, plus strictes que celles de la firm :
  - perte max perso du jour
  - arrêt après N pertes consécutives
  - nombre max de trades
  - pas de position X min autour d'une annonce rouge (voir #670 (Bouclier annonces))
  - actifs autorisés
- Les règles sont préremplies depuis la séance précédente.
- En live : suivi de chaque règle et alerte au premier dépassement.
- Au débrief : règles respectées et enfreintes, avec le P&L associé à chaque infraction.

## Critères d'acceptation
- [ ] Saisie du contrat dans la pré-session, en moins de 30 s, préremplie depuis la dernière séance
- [ ] Une limite perso plus large que celle de la firm est signalée (la règle de la firm reste celle qui compte)
- [ ] Suivi en direct de chaque règle dans la Session live, alerte in-app au premier dépassement (une seule fois par règle et par séance)
- [ ] Débrief : liste des règles respectées / enfreintes et P&L des trades faits après l'infraction
- [ ] Les détecteurs du moteur behavior sont réutilisés, pas dupliqués
- [ ] Contrat modifiable pendant la séance, avec la trace de la modification au débrief
- [ ] Compte démo : un contrat rempli dans le seed

## Points d'appui dans le code
- `apps/app-mytradingcoach/src/app/features/today-session/` (pré-session) et `objective-check.util.ts`
- `prisma/schema.prisma:76` : `tradesPerDayMax` du profil (à intégrer au contrat plutôt que de créer un doublon)
- `apps/api-mytradingcoach/src/modules/behavior/behavior-detectors.ts` et `behavior-plan.ts`
- `apps/api-mytradingcoach/src/modules/eco-calendar/` (`EcoEvent`) pour la règle des annonces
- `apps/app-mytradingcoach/src/app/features/dashboard/components/session-live/`

## Contraintes
- Tradovate en lecture seule, jamais d'ordre ni de fermeture de position (contrat NinjaTrader, clause 2i)
- AMF : aucune promesse de gains, messages factuels sans conseil d'achat ou de vente
- Coût IA minimal (persister, mutualiser, `max_tokens` plafonné, pas d'IA hors prod)
- Mobile first (390 px d'abord)
- Disclaimer « estimation MyTradingCoach » partout où des règles de firm s'affichent
- Compte démo : mutations déjà bloquées par `DemoReadOnlyGuard` ; enrichir le seed démo pour que la feature y soit visible ; tout cron ou envoi ciblant des users exclut `isDemo`

## Dépendances
- #666 (Notifications push) pour l'alerte hors de l'onglet ; peut sortir avant avec l'alerte in-app seulement
- Lié à #670 (Bouclier annonces) (règle du contrat)

## Effort estimé (S / M / L)
M

## Gating envisagé (Free / Premium)
À définir.

## Comment implémenter ce ticket (consignes pour Claude Code)
1. Lis CLAUDE.md, ce ticket et tous ses commentaires.
2. Regarde le code concerné et écris un plan court dans `docs/audit-<feature>.md` (fichiers réels, étapes).
3. Liste les choix ouverts du ticket (gating, seuils, textes…) et propose une réponse pour chacun.
4. **Arrête-toi et attends l'OK de Greg avant de coder.** Si la feature a beaucoup d'interface, propose d'abord une maquette HTML à valider.
5. Ensuite : worktree séparé depuis `beta`, mobile first (390 px d'abord), un commit par étape, typecheck avant chaque push (`nx run-many -t typecheck`, specs comprises), captures 390 et 1440, mise à jour des agents `.claude/agents/` concernés (`plans.md` si le gating change).
6. **Rien n'est poussé sans le « OK push » de Greg.**


## Tri du relecteur (2026-11-26)

« 667 B audit+maquette+modèle/API »

## Cadrage du relecteur (2026-11-28, tri du 26/11 : « B audit+maquette+modèle/API »)

Une PR vers `dev`, tout derrière `SESSION_CONTRACT_ENABLED=false`. La maquette est locale (`maquettes/mockup-contrat-session.html`, gitignorée) et validée avant le code (design, puis relecteur). Un rapport d'étape au relecteur après la mise à jour de `docs/audit-contrat-session.md` et la maquette. Le worktree depuis `beta` et le « OK push » du ticket sont périmés (circuit actuel).

- Critère 1 (saisie en moins de 30 s, préremplie) : dans la PR côté API. Table additive `SessionContract` (1 par séance), `contract?` dans `POST /session/start`, `GET /session/contract/defaults?accountId` (dernier contrat du compte, sinon le profil : `tradesPerDayMax`, `newsShieldMinutes`, `tradingAssets`, sans doublon de `tradesPerDayMax`). Le formulaire est hors PR (ticket d'interface) ; la maquette fait partie de la PR.
- Critère 2 (limite plus large que la firm) : dans la PR côté API. `looserThanFirm` sur la perte max perso, seulement si la phase a une `dailyLossLimitAt`. Le texte « la règle de la firm reste celle qui compte » et la mention « estimation MyTradingCoach » sont dans la maquette, puis dans le ticket d'interface.
- Critère 3 (suivi en direct, alerte une fois par règle et par séance) : `evaluateContract` dans la PR (pur, `@mtc/shared`, specs). Affichage et alerte in-app hors PR, calculés côté front par cette évaluation (séance Tradovate ou manuelle), sans nouvel envoi serveur ni push (#666 plus tard). Quand la séance a un contrat, l'alerte du contrat remplace le bandeau #671 de C1 et C2, jamais deux alertes pour la même règle.
- Critère 4 (débrief : respectées, enfreintes, P&L après) : dans la PR côté API. `getSessionDetail` et `today` renvoient `contract` et `evaluation`, calculée à la lecture, rien de stocké. Infraction = le trade qui franchit la règle (trades max : le N+1ᵉ ; pertes d'affilée : la N+1ᵉ entrée après N pertes, comme C1 ; perte max : le trade qui fait passer le P&L net réalisé sous −X ; actifs : un trade hors liste ; annonces : `tradedAt` dans [T−X, T+X] d'une annonce à fort impact sur ses devises, même prédicat que #670). P&L après = trades clôturés suivants, le fautif exclu, net de frais, devise du compte (#947). Affichage hors PR.
- Critère 5 (détecteurs réutilisés) : dans la PR. Les primitives (série de pertes, comptage, fenêtre d'annonce, `assetCurrencies`) sont écrites une seule fois dans `@mtc/shared` et appelées par `behavior-detectors.ts`, `debrief-news-window.ts` et `evaluateContract`. Le contrat fournit les seuils de C1, C2 et D1 quand la séance en a un. C1 avec contrat sonne aussi en apprentissage ; sans contrat, rien ne change. Un spec d'équivalence C1 / contrat.
- Critère 6 (contrat modifiable, trace au débrief) : dans la PR côté API. `PATCH /session/:id/contract` (séance ACTIVE et à l'utilisateur, upsert), `edits` `{ at, field, from, to }` plafonné à 50. Chaque trade est jugé sur la règle en vigueur à son heure ; desserrer une règle après l'infraction ne l'efface pas. Affichage de la trace hors PR.
- Critère 7 (démo) : dans la PR. Un contrat sur les séances démo, avec au moins une infraction, un P&L après et une modification tracée, dans `session-contract-example.ts`, module pur (chargé par tsx).
- Flag : `SESSION_CONTRACT_ENABLED`, éteint par défaut. Éteint : routes du contrat en 404, `contract` ignoré au `start`, rien au débrief. Le front le lit par une réponse authentifiée, jamais par un endpoint public. L'allumage (dev puis prod) est une action de Greg, après le ticket d'interface.
- Gating : provisoirement gratuit (compagnon de session complet et données du trader sans IA, `plans.md` ; précédent du bouclier #670), sans `PremiumGuard`. `gating-detail.md` et `matrice-features.md` à jour, `PLAN_BENEFITS` inchangé. Validation par Greg (« Pour Greg »).
- Références à jour : `.claude/reference/` (routes de séance, détecteurs, schéma, gating). Entrée `decisions.md` datée du 2026-11-28 dans le même commit.
- Pour Greg : gating (tout gratuit, ou débrief des infractions en Premium) ; allumage du flag après le ticket d'interface.

## Rapport d'étape au relecteur (2026-11-28) : feu vert pour coder

Maquette v3 conforme (vérificateur design, 2 tours). Réponses du relecteur :
- A. Alerte « pertes d'affilée » du contrat en ambre : le rouge de #671 est une exception datée pour la gravité haute des détecteurs, on ne l'étend pas ; le bandeau rouge C1 reste pour les séances sans contrat.
- B. Vert `.obj-ok` des objectifs du matin : écart déjà en ligne, ticket à part dans Idées, hors #667.
- C. Textes « Tu avais fixé : … » conformes AMF (constats, jamais d'impératif) : même modèle pour toutes les règles.
- D. Points du ticket d'interface (captures 360, 768, 1024, 1920, 2560 ; icône ambre sur la puce perte max repliée ; `.ba-wrap` dans `.lv-sticky`) : dans le corps du ticket de suite.
- Libellé : « Arrêt après N pertes d'affilée » (jamais « Stop après », qui veut dire stop-loss pour un trader futures).
