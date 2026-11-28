# PROMPT-672 : détecteur « SL déplacé pendant le trade »

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #672 : Détecteur « SL déplacé pendant le trade »

## Pourquoi
Éloigner son stop quand le trade part contre soi est l'erreur classique qui transforme une petite perte en compte grillé. C'est un geste précis, mesurable, et le trader le fait presque toujours sans s'en rendre compte.

## Ce que ça fait
Alerte quand le stop est éloigné du prix d'entrée alors que le trade est en perte.

## Critères d'acceptation
- [ ] Détection d'un SL éloigné (achat : stop abaissé ; vente : stop remonté) pendant que le latent est négatif
- [ ] Comparaison entre la version précédente et la nouvelle version de l'ordre stop
- [ ] Rapprocher le stop (protéger) ne déclenche rien
- [ ] Alerte factuelle (« Stop éloigné de 6 ticks sur NQ, trade en perte »), une fois par trade
- [ ] Nouveau détecteur dans le moteur behavior, enregistré en silence d'abord comme les autres
- [ ] Lecture seule stricte : aucune action sur l'ordre
- [ ] Compte démo : un cas dans le seed

## Points d'appui dans le code
- `apps/api-mytradingcoach/src/modules/integrations/tradovate/tradovate-orders.ts` : les `orderVersion` sont gardées en mémoire par connexion WebSocket, mais Redis ne garde que **la dernière version**. Comparer la version précédente au moment de la modification
- `apps/api-mytradingcoach/src/modules/behavior/behavior-detectors.ts`

## Contraintes
- Tradovate en lecture seule, jamais d'ordre ni de fermeture de position (contrat NinjaTrader, clause 2i)
- AMF : aucune promesse de gains, messages factuels sans conseil d'achat ou de vente
- Coût IA minimal (persister, mutualiser, `max_tokens` plafonné, pas d'IA hors prod)
- Mobile first (390 px d'abord)
- Disclaimer « estimation MyTradingCoach » partout où des règles de firm s'affichent
- Compte démo : mutations déjà bloquées par `DemoReadOnlyGuard` ; enrichir le seed démo pour que la feature y soit visible ; tout cron ou envoi ciblant des users exclut `isDemo`

## Dépendances
- #601 (lecture des ordres actifs SL/TP) : livré
- #671 (alertes de comportement, phase 2) pour l'affichage

## Effort estimé (S / M / L)
S (une fois #601 livré, ce qui est le cas)

## Gating envisagé (Free / Premium)
Premium (à valider).

## Comment implémenter ce ticket (consignes pour Claude Code)
1. Lis CLAUDE.md, ce ticket et tous ses commentaires.
2. Regarde le code concerné et écris un plan court dans `docs/audit-<feature>.md` (fichiers réels, étapes).
3. Liste les choix ouverts du ticket (gating, seuils, textes…) et propose une réponse pour chacun.
4. **Arrête-toi et attends l'OK de Greg avant de coder.** Si la feature a beaucoup d'interface, propose d'abord une maquette HTML à valider.
5. Ensuite : worktree séparé depuis `beta`, mobile first (390 px d'abord), un commit par étape, typecheck avant chaque push (`nx run-many -t typecheck`, specs comprises), captures 390 et 1440, mise à jour des agents `.claude/agents/` concernés (`plans.md` si le gating change).
6. **Rien n'est poussé sans le « OK push » de Greg.**

## Arbitrages du relecteur (2026-11-28)

- Consignes périmées du ticket : branche depuis `origin/dev` (pas `beta`, décision du 08/11) ; push sur « OK à 100 % » du relecteur (pas de « OK push » de Greg, décision du 13/11) ; le relecteur donne l'OK du plan (délégation du 21/11).
- Option (a) : « trade en perte » devient « stop de sortie éloigné en finissant du côté perte de l'entrée » (latent inconnu au moment où le stop bouge ; pas de `brokerOpenPnl` périmé ; pas d'appel REST).
- Seuil 2 ticks (`behavior.constants`), une fois par position (SET NX compte + contrat + ouverture, 12 h), severity unique pendant la phase silencieuse, message « Stop éloigné de 6 ticks sur NQ (risque porté à 14 ticks). », type `E1_STOP_WIDENED`, mêmes interrupteurs que les autres détecteurs, hors démo.
- Seed démo : oui, module pur `demo-data/stop-widened-example.ts` (alerte E1 sur un trade NQ perdant), invisible avant #671.
- Gating : sans objet tant que rien n'est affiché (à trancher à #671).
- Plan court `docs/audit-672.md` livré dans la même PR.
