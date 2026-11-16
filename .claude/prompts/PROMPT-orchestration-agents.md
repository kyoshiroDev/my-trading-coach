# PROMPT — Orchestration des agents : chaque prompt guidé par les agents concernés, le relecteur valide à la fin

> **Contexte (15/11).** Greg veut que chaque prompt soit guidé automatiquement par les agents du dépôt, chacun dans sa spécialité, et que l'agent `relecteur` soit **toujours** appelé en dernier : c'est lui qui arbitre les recommandations et qui décide « OK à 100 % » (push + PR vers `dev`) ou non.
>
> Le circuit relecteur existe déjà (décision du 13/11 : à 100 %, push et PR vers `dev` sans « OK push », seul Greg merge). Ce qui manque, constaté sur `main` le 15/11 :
> 1. **Pas de routage** : `CLAUDE.md` dit « lire l'agent pertinent », sans dire lequel pour quel fichier ou quel type de tâche. Rien ne garantit qu'`angular` + `design` sont lus pour un écran, ou `prisma` + `security` pour une migration qui touche les comptes.
> 2. **Les agents de domaine ne vérifient rien** : ce sont des documents de référence (pas d'outils, pas de checklist). Ils sont lus avant de coder (au mieux), jamais consultés pour relire le diff dans leur domaine.
> 3. **Des agents trop gros pour être vraiment lus** : `nestjs.md` 238 Ko (~61 000 tokens, 53 sections), `angular.md` 141 Ko (~36 000 tokens), `deploy.md` 65 Ko, `astro.md` 48 Ko. Ils mêlent les règles permanentes et l'historique des fonctionnalités (« Calendrier éco… #920 », « Offre fondateur #525 »…). Lu en entier à chaque tâche, c'est coûteux et les règles importantes se perdent ; lu en diagonale, des règles sont ratées.
> 4. **`CLAUDE.md` contredit les décisions** : la vision parle encore de « crypto, forex, actions » alors que la cible est le trader futures en prop firm (`contexte-com.md`) ; « demander d'abord : nouvelle feature ou pas ? » alors que tout part de `dev` dans les deux cas ; numérotation « Avant / Pendant » en double.
>
> Tâche de documentation et d'outillage : **aucun code de l'app ne change**. Branche `docs/orchestration-agents` depuis `origin/dev` à jour, dans un worktree séparé.

## Règles de travail
- Enregistre ce prompt dans `.claude/prompts/PROMPT-orchestration-agents.md`.
- **Aucune information ne doit être perdue.** Tout ce qui sort d'un agent est déplacé, jamais supprimé (sauf une contradiction avec `decisions.md`, signalée et listée). Vérification mécanique obligatoire à l'étape 2.
- `decisions.md` fait foi sur tout ce qu'il couvre ; en cas de contradiction avec un agent, l'agent est corrigé et la correction listée.
- Commits atomiques `docs(agents): …`, un par étape. Circuit habituel : relecteur à chaque arrêt, « OK à 100 % » → push + PR vers `dev`.

## Étape 0 — Audit (arrêt, validé par le relecteur)
Rapport court :
1. Pour chaque agent : taille, sections, et pour chaque section « règle permanente » ou « note de fonctionnalité / historique ».
2. Les doublons entre agents (ex. « Contrat front ↔ API », « `@mtc/shared` », « Connexion Google », « Entonnoir Premium » présents dans `nestjs.md` et `angular.md`) : où doit vivre la version unique.
3. Les contradictions entre agents, `CLAUDE.md`, `decisions.md` et `contexte-com.md` (beta, essai 30 jours, cible crypto, etc.).
4. Le découpage proposé pour chaque gros agent (liste des fichiers de référence à créer).
5. Comment Claude Code charge les sous-agents (`.claude/agents/*.md` : frontmatter `name`, `description`, `tools`, éventuellement `model`) et les commandes (`.claude/commands/*.md`), dans la version installée.

Le relecteur valide le plan ; il ne remonte à Greg que ce qui lui revient.

## Étape 1 — Routage dans `CLAUDE.md`
Ajoute une section **« Agents à suivre selon la tâche »**, en tableau, et rends-la obligatoire :

| Si la tâche touche… | Agents à lire avant de coder | Agents vérificateurs après |
|---|---|---|
| `apps/api-mytradingcoach/**` | nestjs | nestjs, security (si auth, guards, secrets, données perso), tests |
| `prisma/**`, migrations | prisma, nestjs | prisma, security |
| `apps/app-mytradingcoach/**` | angular, design | angular, design, tests |
| `apps/admin-mytradingcoach/**` | angular, design (+ `admin-mytradingcoach.html`) | angular, design |
| `apps/landing-mytradingcoach/**` | astro, design | astro, design |
| prix, plans, essai, gating, quotas, offre fondateur, e-mails liés aux plans | plans (+ le domaine du fichier) | plans |
| calculs de P&L, instruments, frais, R/R, drawdown | instruments (+ domaine) | instruments, tests |
| auth, JWT, OAuth broker, permissions, `.env`, rate limiting | security (+ domaine) | security |
| `.github/**`, `docker-compose*`, `infra/**`, déploiement | deploy | deploy |
| textes visibles par les traders, e-mails, landing, posts | `contexte-com.md` (+ domaine) | relecteur (contenu) |
| tests ajoutés ou corrigés | tests | tests |

Puis :
- **Toujours en dernier : `relecteur`**, quel que soit le domaine.
- Le tableau est complété par les chemins réels trouvés à l'étape 0 (libs `@mtc/shared`, `libs/front/*`, scripts…).
- Corrige dans `CLAUDE.md` : la vision (trader futures en prop firm, renvoi vers `contexte-com.md`), la question « nouvelle feature ou pas ? » (supprimée : tout part de `dev`), la numérotation, et toute phrase contraire à `decisions.md`.

## Étape 2 — Alléger les agents sans rien perdre
Pour chaque agent de plus de **20 Ko** (nestjs, angular, deploy, astro, plans, prisma, design, tests selon l'audit) :
- **L'agent garde** (cible ≤ 20 Ko, `nestjs` ≤ 25 Ko) : son rôle, la stack, les **règles permanentes non négociables**, les pièges, la **checklist de vérification** (étape 3) et un **index** des fichiers de référence (une ligne par fichier : sujet + quand le lire).
- **Le reste part dans `.claude/reference/<domaine>/<sujet>.md`** (ex. `reference/nestjs/calendrier-eco.md`, `reference/nestjs/synchro-broker-tradovate.md`, `reference/angular/offre-fondateur.md`), contenu déplacé **à l'identique**, avec un titre et la date d'origine.
- Une section commune à deux agents vit **une seule fois** (dans `reference/commun/…`), les deux agents y renvoient.
- **Vérification mécanique** : un script compare l'ensemble des lignes non vides avant / après (agents d'origine vs agents + références). Toute ligne manquante est soit retrouvée, soit listée comme contradiction corrigée avec la décision qui la remplace. Mets la sortie du script dans le rapport.
- Mets à jour la règle 7 de `CLAUDE.md` : « mettre à jour l'agent concerné » devient « mettre à jour le fichier de référence concerné (ou en créer un, et l'ajouter à l'index de l'agent) ; l'agent lui-même ne change que pour une règle permanente ».

## Étape 3 — Les agents de domaine deviennent vérificateurs
Pour chaque agent de domaine (angular, astro, deploy, design, instruments, nestjs, plans, prisma, security, tests) :
- Frontmatter : ajoute `tools: Read, Grep, Glob, Bash` et une `description` qui dit **quand l'appeler** (« À appeler pour vérifier un diff qui touche … »).
- En tête du fichier, une section **« Vérification d'un diff »** : 8 à 15 points concrets et vérifiables propres au domaine (ex. nestjs : Logger et pas `console.log`, Prisma hors contrôleurs, DTO Zod, comptes démo exclus des agrégats et des envois, prompt caching et logging IA, erreurs Anthropic gérées, aucun secret lu… ; angular : `@if`/`@for`, signals, CSS hors `.ts`, tokens du thème, `data-testid`, responsive 390 px, `visibleInterval`… ; plans : cohérence des 4 points landing/front/guard/cron, valeurs depuis `@mtc/shared`…). Les points viennent des règles existantes de l'agent, rien d'inventé.
- Format de réponse imposé, court :
  ```
  Domaine : <nom>
  Verdict : conforme | corrections nécessaires | bloquant
  Corrections : liste numérotée (fichier:ligne, règle, correction)
  Points pour le relecteur : ce qui sort de mon domaine ou demande un arbitrage
  ```
- Un vérificateur ne lit que **le diff de son domaine** et les fichiers de référence utiles, pas tout l'agent des autres.

## Étape 4 — Le circuit complet, appliqué à chaque prompt
1. Crée la commande **`.claude/commands/tache.md`** (utilisable en `/tache` au début d'un prompt, et suivie même sans la commande) qui impose, dans l'ordre :
   1. enregistrer le prompt dans `.claude/prompts/` ;
   2. identifier les domaines touchés avec le tableau de routage, et lire les agents « avant de coder » (règles + seulement les références utiles) ;
   3. faire le travail, builder après chaque partie ;
   4. appeler **en parallèle** chaque agent vérificateur concerné sur le diff réel ; appliquer leurs corrections ;
   5. appeler **en dernier** le `relecteur`, avec le prompt, le résumé, les verdicts de tous les vérificateurs et les questions ;
   6. boucler (corrections → vérificateurs concernés → relecteur) jusqu'à **« OK à 100 % »** ou un point qui revient à Greg ;
   7. à 100 % : conflits vérifiés, push, PR vers `dev`, suivi de la CI jusqu'au vert ;
   8. n'envoyer à Greg que la section « Pour Greg » du relecteur + 5 lignes de résumé.
2. Mets à jour `relecteur.md` :
   - « OK à 100 % » **impossible** si un domaine touché n'a pas son verdict de vérificateur, ou si un vérificateur a dit « corrections nécessaires » / « bloquant » sans que ce soit corrigé et revérifié ;
   - en cas de désaccord entre deux vérificateurs, c'est le relecteur qui tranche (une ligne de raison), en suivant `decisions.md` puis les agents ;
   - la description de PR ajoute une section **« Vérificateurs »** : domaine → verdict.
3. Mets à jour `CLAUDE.md` (section workflow) et `CONTRIBUTING.md` pour décrire ce circuit en 10 lignes maximum.

## Étape 5 — Test à blanc (arrêt pour le rapport)
- Rejoue le circuit **sans rien pousser** sur une PR récente déjà mergée qui touche plusieurs domaines (ex. une PR de l'audit fonctionnel avec API + app), à partir de son prompt dans `.claude/prompts/` : montre le routage choisi, les verdicts de chaque vérificateur, et la réponse finale du relecteur.
- Mesure : taille de chaque agent avant / après, et nombre de fichiers de référence.
- Puis circuit normal sur cette branche : vérificateurs (relecteur en dernier) → « OK à 100 % » → push et PR vers `dev`. Je merge.
