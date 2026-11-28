# PROMPT-alertes-comportement-671 : alertes de comportement, phase 2

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #671 : Alertes de comportement, phase 2 : affichage dans la Session live

## Pourquoi
Le moteur de comportement de #602 enregistre ses alertes en silence (`BEHAVIOR_ALERTS_UI=false`). Une fois les chiffres validés sur la semaine silencieuse, il doit remplacer l'anti-tilt actuel (#371) et s'afficher là où le trader regarde pendant la séance. Une alerte juste, au bon moment, est ce qui l'arrête avant de casser son compte.

## Ce que ça fait
- Affichage dans la Session live des alertes enregistrées : bandeau ambre, puis rouge si ça s'aggrave, avec une phrase factuelle.
- Bouton « Pas pour mon style » pour couper un détecteur.
- Historique des alertes au débrief.
- Seuils ajustés d'après la semaine silencieuse et l'exposition au moment de l'alerte.
- Remplacement de l'anti-tilt actuel par le moteur behavior.
- Trade rapide : sélecteur d'émotion par emoji relié au moteur (voir ci-dessous).

## Critères d'acceptation
- [ ] Bandeau ambre puis rouge dans la Session live, une phrase factuelle, lisible à 390 px
- [ ] « Pas pour mon style » coupe le détecteur pour ce trader, réversible depuis le profil
- [ ] Historique des alertes au débrief, avec ce qui a suivi chaque alerte
- [ ] Seuils réglés d'après le rapport de la semaine silencieuse (`scripts/replay-behavior-alerts.ts`) et l'exposition au moment de l'alerte
- [ ] **Anti-tilt remplacé** : `tilt-detection.ts` et `tilt-alerts.service.ts` retirés au profit des détecteurs behavior, sans double alerte pendant la transition
- [ ] **Emoji de Trade rapide** : l'émotion choisie (😎 Confiant, 🎯 Focalisé, 😐 Neutre, 😰 Stressé, 😨 Peur, 🤬 Revenge, `quick-trade.component.ts:24`) alimente le moteur (ex. 🤬 ou 😨 saisi juste après une perte = signal de vengeance renforcé). La valeur par défaut `CONFIDENT` (`qtEmotion`, ligne 68) fausse ces données : à revoir (choix ouvert : pas de défaut, ou dernière émotion saisie)
- [ ] Flag `BEHAVIOR_ALERTS_UI` activé d'abord sur beta, puis en prod
- [ ] Compte démo : alertes visibles dans le seed

## Points d'appui dans le code
- `apps/api-mytradingcoach/src/modules/behavior/` : `behavior-alerts.service.ts`, `behavior-detectors.ts`, `behavior-baseline.ts`, `behavior-replay.ts`
- `apps/api-mytradingcoach/src/config/env.ts` (`BEHAVIOR_ALERTS_UI`)
- `apps/api-mytradingcoach/src/modules/integrations/tradovate/tilt-detection.ts` et `tilt-alerts.service.ts` (anti-tilt de #371 à remplacer)
- `apps/app-mytradingcoach/src/app/core/services/prop-alerts.service.ts`
- `apps/app-mytradingcoach/src/app/features/dashboard/components/session-live/session-live.component.ts`
- `apps/app-mytradingcoach/src/app/features/dashboard/components/session-live/components/quick-trade/quick-trade.component.ts`

## Contraintes
- Tradovate en lecture seule, jamais d'ordre ni de fermeture de position (contrat NinjaTrader, clause 2i)
- AMF : aucune promesse de gains, messages factuels sans conseil d'achat ou de vente
- Coût IA minimal (persister, mutualiser, `max_tokens` plafonné, pas d'IA hors prod)
- Mobile first (390 px d'abord)
- Disclaimer « estimation MyTradingCoach » partout où des règles de firm s'affichent
- Compte démo : mutations déjà bloquées par `DemoReadOnlyGuard` ; enrichir le seed démo pour que la feature y soit visible ; tout cron ou envoi ciblant des users exclut `isDemo`

## Dépendances
- #602 : semaine d'enregistrement silencieux terminée et chiffres validés
- #666 (Notifications push) pour les alertes hors de l'onglet

## Effort estimé (S / M / L)
M

## Gating envisagé (Free / Premium)
Premium, comme la détection du tilt aujourd'hui (#371). À valider.

## Comment implémenter ce ticket (consignes pour Claude Code)
1. Lis CLAUDE.md, ce ticket et tous ses commentaires.
2. Regarde le code concerné et écris un plan court dans `docs/audit-<feature>.md` (fichiers réels, étapes).
3. Liste les choix ouverts du ticket (gating, seuils, textes…) et propose une réponse pour chacun.
4. **Arrête-toi et attends l'OK de Greg avant de coder.** Si la feature a beaucoup d'interface, propose d'abord une maquette HTML à valider.
5. Ensuite : worktree séparé depuis `beta`, mobile first (390 px d'abord), un commit par étape, typecheck avant chaque push (`nx run-many -t typecheck`, specs comprises), captures 390 et 1440, mise à jour des agents `.claude/agents/` concernés (`plans.md` si le gating change).
6. **Rien n'est poussé sans le « OK push » de Greg.**

## Cadrage du relecteur (2026-11-28, tri du 26/11 : « B derrière BEHAVIOR_ALERTS_UI »)

Une PR vers `dev`, tout derrière `BEHAVIOR_ALERTS_UI=false` ; maquette validée par le relecteur avant le code (après le design), locale dans `maquettes/` ; un rapport d'étape au relecteur après `docs/audit-alertes-comportement.md` et la maquette.

- Critère 1 (bandeau Session live, ambre puis rouge, 390 px) : dans la PR, alimenté par `behavior:alert`, seulement si le flag est vrai.
- Critère 2 (« Pas pour mon style ») : dans la PR, table additive `BehaviorDetectorMute (userId, detector, createdAt)` unique sur le couple, réactivation depuis le Profil ; un détecteur coupé n'est plus envoyé (socket, push) mais reste enregistré.
- Critère 3 (historique au débrief) : dans la PR, alertes de la semaine et trades clôturés qui ont suivi (nombre et P&L dans la devise du compte, #947), sans IA.
- Critère 4 (seuils) : hors PR, seuils actuels gardés (validation du rapport silencieux par Greg).
- Critère 5 (anti-tilt) : flag vrai = l'anti-tilt #371 se tait, flag faux = inchangé, jamais de double alerte (spec des deux cas) ; suppression de `tilt-detection.ts` et `tilt-alerts.service.ts` = ticket de suite après l'activation en prod.
- Critère 6 (Trade rapide) : plus d'émotion présélectionnée (si le DTO l'exige, remonter avant de changer le contrat) ; 🤬/😨 juste après une perte enregistré en silence, sans poids dans les seuils.
- Critère 7 (flag) : hors PR, action de Greg, `dev` puis prod (plus `beta`, décision du 2026-11-08). Worktree depuis `beta` et « OK push » du ticket : périmés (circuit actuel).
- Critère 8 (démo) : dans la PR, quelques alertes passées (ambre et rouge) visibles dans l'historique du débrief et le Profil.
- Gating : Premium (prolonge l'anti-tilt #371), côté API ; teaser côté front pour un gratuit ; `gating-detail.md` et `matrice-features.md` à jour, `PLAN_BENEFITS` inchangé (`anti_tilt`).
- Le front connaît le flag par une réponse authentifiée (`/auth/me` ou config utilisateur), jamais un endpoint public.
- Pour Greg : seuils (garder les actuels puis ticket à part après validation du rapport, ou valider le rapport maintenant) ; activation du flag (dev d'abord, puis prod après les seuils).

## Rapport d'étape au relecteur (2026-11-28) : feu vert pour coder

Maquette v2 conforme (vérificateur design). Réponses du relecteur :
- A. Exception `--red` (bandeau de gravité haute ou 2ᵉ signal en 30 min, pastille au Débrief) : dans son mandat, datée 2026-11-28 dans `design.md` et `decisions.md` ; gravité jamais portée par la couleur seule.
- B. Deux zones `aria-live` persistantes et invisibles (polite pour l'ambre, assertive pour le rouge) ; le bandeau visible n'a pas de `role` d'annonce (une seule lecture par alerte).
- C. Messages des détecteurs corrigés au serveur (espace insécable avant « : » et « % », « 11ᵉ », apostrophe ’), dans un commit à part ; pas de normalisation au front.
- D. `GET /behavior/config` (authentifié, sans Premium) ; int-spec : sans jeton → 401.
- E. Signal `F1_EMOTION_AFTER_LOSS` dans `BehaviorAlert`, fenêtre 15 min, jamais émis ; liste centrale `BEHAVIOR_SIGNAL_TYPES` exclue partout (historique, autopsie, baseline, rejeu, détecteurs, anti-spam), spec autopsie.
- F. Conservation de `BehaviorAlert` : hors PR, issue #1338 pour Greg (reco : 13 mois).
- G. Une PR, 12 commits ; historique et comptes perdus selon `compte-perdu.md` ; budget du bundle avant / après dans le rapport final ; sujets de commit en minuscules.
