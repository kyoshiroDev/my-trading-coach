# PROMPT-670 — Bouclier annonces : positions ouvertes avant une annonce à fort impact

## Texte de Greg (2026-11-23)

> attaque le #670

## Tâche : issue #670

## Pourquoi
Les annonces à fort impact (NFP, CPI, FOMC…) provoquent des mouvements qui font sauter les limites journalières en quelques secondes. La plupart des firms le savent, le trader l'oublie au mauvais moment.

## Ce que ça fait
- Alerte si une position est ouverte, ou s'ouvre, moins de X min avant une annonce à fort impact.
- Seuil X réglable.
- Au débrief : stat « tes trades autour des annonces » (nombre, P&L, comparé au reste de la séance).

## Critères d'acceptation
- [ ] Nouveau détecteur dans le moteur behavior, pas un service à part
- [ ] Alerte avant l'annonce si une position est ouverte, et à l'ouverture d'une position dans la fenêtre
- [ ] Seuil réglable (valeur par défaut à proposer), seulement les annonces à fort impact des devises de l'actif tradé
- [ ] Stat au débrief : trades dans la fenêtre des annonces vs le reste
- [ ] Message factuel (« NFP dans 4 min, position ouverte sur NQ »), sans conseil
- [ ] Compte démo : un trade autour d'une annonce dans le seed

## Points d'appui dans le code
- `apps/api-mytradingcoach/src/modules/eco-calendar/` (`EcoEvent`)
- `apps/api-mytradingcoach/src/modules/behavior/behavior-detectors.ts` (nouveau détecteur)
- `apps/app-mytradingcoach/src/app/features/dashboard/components/session-live/components/live-next-event/` (ligne « Prochaine annonce »)

## Contraintes
- Tradovate en lecture seule, jamais d'ordre ni de fermeture de position (contrat NinjaTrader, clause 2i)
- AMF : aucune promesse de gains, messages factuels sans conseil d'achat ou de vente
- Coût IA minimal (persister, mutualiser, `max_tokens` plafonné, pas d'IA hors prod)
- Mobile first (390 px d'abord)
- Disclaimer « estimation MyTradingCoach » partout où des règles de firm s'affichent
- Compte démo : mutations déjà bloquées par `DemoReadOnlyGuard` ; enrichir le seed démo pour que la feature y soit visible ; tout cron ou envoi ciblant des users exclut `isDemo`

## Dépendances
- Peut devenir une règle du #667 (Contrat de session) : garder ce ticket et les lier
- #671 (alertes de comportement, phase 2) pour l'affichage en live

## Effort estimé (S / M / L)
S

## Gating envisagé (Free / Premium)
À définir.

## Comment implémenter ce ticket (consignes pour Claude Code)
1. Lis CLAUDE.md, ce ticket et tous ses commentaires.
2. Regarde le code concerné et écris un plan court dans `docs/audit-<feature>.md` (fichiers réels, étapes).
3. Liste les choix ouverts du ticket (gating, seuils, textes…) et propose une réponse pour chacun.
4. **Arrête-toi et attends l'OK de Greg avant de coder.** Si la feature a beaucoup d'interface, propose d'abord une maquette HTML à valider.
5. Ensuite : worktree séparé depuis `beta`, mobile first (390 px d'abord), un commit par étape, typecheck avant chaque push (`nx run-many -t typecheck`, specs comprises), captures 390 et 1440, mise à jour des agents `.claude/agents/` concernés (`plans.md` si le gating change).
6. **Rien n'est poussé sans le « OK push » de Greg.**


## Réponses de Greg (2026-11-23)

- Affichage avant #671 : « Tout de suite » (choix proposé).
- Gratuit ou Premium, et mise en route : « envoie les demande au relecteur ». Tranchés par le relecteur : alerte en séance gratuite, stat du débrief Premium ; `NEWS_SHIELD_ENABLED` éteint par défaut, allumé sur dev au merge, en prod par Greg.
