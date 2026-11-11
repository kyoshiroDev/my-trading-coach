# PROMPT — audit-chiffres

## Prompt initial (texte exact)

crois tu que l'agent de relecture pour refaire un tour complet de l'application afin de voir si il nous reste des bug a coriger et si il y en as suis ses recomandation pour les corriger l'objectif ne plus avoir de bug ou d'ecart de chiffre dans l'application elle doit être parfaite

## Complément (texte exact)

ok commence par les chiffres, vas-y

## Cadrage retenu (proposé par la session, accepté par Greg)

- Périmètre : les chiffres d'abord (P&L, stats, totaux, montants, arrondis, cohérence entre vues). L'audit fonctionnel complet viendra plus tard.
- Audit en lecture par les agents instruments / nestjs / angular, avec preuve (fichier, ligne, entrée → attendu → obtenu).
- Chaque écart est reproduit par un test qui échoue avant d'être corrigé ; un commit atomique par bug.
- Relecteur à chaque arrêt.
