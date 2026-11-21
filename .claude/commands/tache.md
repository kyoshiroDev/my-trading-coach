---
description: Circuit complet d'un prompt de Greg — routage des agents, travail, vérificateurs en parallèle, relecteur en dernier, push et PR vers dev à « OK à 100 % ».
argument-hint: <prompt de la tâche>
---

Tu traites la tâche ci-dessous en suivant ce circuit, dans l'ordre. Ce circuit s'applique à **tout** prompt de Greg,
même sans `/tache` (CLAUDE.md, « Workflow obligatoire »).

## Tâche

$ARGUMENTS

## Circuit

1. **Enregistrer le prompt** tel quel dans `.claude/prompts/PROMPT-<nom>.md` (texte exact, compléments ajoutés à la suite),
   sur une branche partie de `origin/dev` à jour, dans un worktree dédié. Créer ou retrouver l'issue de suivi
   (projet GitHub n° 4) et la passer « en cours ». Le prompt est commité avec le travail.
2. **Router** : avec le tableau « Agents à suivre selon la tâche » de `CLAUDE.md`, lister les domaines touchés
   (chemins prévus + sujets : prix, P&L, auth, textes…). Lire les agents « avant de coder » : règles, checklist et index,
   puis **seulement** les fichiers `.claude/reference/…` que l'index rattache à la tâche. Lire `decisions.md` pour ce qui
   concerne la tâche, `contexte-com.md` pour tout texte visible.
3. **Faire le travail**, builder après chaque partie (zéro erreur avant de continuer), `pnpm` uniquement.
   Mettre à jour le fichier de référence concerné si un comportement change (règle 8 de `CLAUDE.md`).
4. **Vérificateurs en parallèle** : appeler dans un seul message chaque agent vérificateur de la 3ᵉ colonne du tableau
   pour les domaines touchés, sur le diff réel (`git diff origin/dev...HEAD`). Leur donner : le nom du prompt, la liste
   des fichiers de leur domaine, ce qui a été lancé (lint, typecheck, tests). Appliquer leurs corrections.
5. **Relecteur en dernier** : appeler `relecteur` avec le prompt, un résumé du travail, le **verdict de chaque
   vérificateur** (domaine → verdict, corrections appliquées), les sorties de lint / typecheck / tests et les questions.
6. **Boucler** : corrections → vérificateurs des domaines concernés (revérification) → relecteur, jusqu'à
   **« OK à 100 % »** ou un point qui revient à Greg (décision business, prod, VPS, Stripe live : voir `relecteur.md`).
7. **À 100 %** : vérifier les conflits avec `origin/dev`, pousser, ouvrir la PR vers `dev` (description du relecteur,
   section « Vérificateurs » comprise), l'ajouter au projet n° 4 (`Partie de #n`), suivre la CI jusqu'au vert.
   Jamais vers `main`. Merge vers `dev` par la session une fois la CI verte (merge commit, une PR à la fois, attendre la CI/CD de `dev`, décision du 2026-11-21) ; `dev` → `main`, seul Greg merge.
8. **Message à Greg** : uniquement la section « Pour Greg » du relecteur, plus 5 lignes de résumé au maximum.
   Nouvelle décision de Greg → en haut de `.claude/decisions.md`, dans le même commit que le travail concerné.

Un arrêt demandé par le prompt (rapport d'étape, captures) suit les étapes 4 à 6 avant d'écrire à Greg ; rien n'est
poussé avant « OK à 100 % ».
