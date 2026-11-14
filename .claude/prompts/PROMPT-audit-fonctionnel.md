# PROMPT — audit-fonctionnel

## Prompt initial (texte exact)

On attaque l'audit fonctionnel

## Contexte (prompt d'origine de l'audit, `PROMPT-audit-chiffres.md`)

crois tu que l'agent de relecture pour refaire un tour complet de l'application afin de voir si il nous reste des bug a coriger et si il y en as suis ses recomandation pour les corriger l'objectif ne plus avoir de bug ou d'ecart de chiffre dans l'application elle doit être parfaite

L'audit des chiffres (#947, #950, #981) est terminé et en prod le 13/11. Cet audit-ci est le « audit fonctionnel complet » annoncé dans son cadrage.

## Cadrage retenu (proposé par la session, retenu par le relecteur le 2026-11-13)

- Objectif : zéro bug fonctionnel (un parcours qui casse, une action qui fait autre chose que ce qu'elle annonce, un écran faux ou bloqué, un accès qui ne respecte pas le plan ou le compte).
- Méthode, la même que pour les chiffres :
  - audit en lecture par les agents nestjs, angular, security et plans, avec une preuve pour chaque bug (fichier, ligne, action → attendu → obtenu) ;
  - chaque bug est reproduit par un test qui échoue, puis corrigé, un commit atomique par bug ;
  - un lot = une sous-issue de #993 = une PR vers dev ;
  - relecteur à chaque arrêt ;
  - parcours clés rejoués en vrai sur un banc local isolé ou sur dev avec un compte de test (jamais le compte de Greg).
- Lots, par ordre de risque :
  1. Parcours cœur du trader : inscription, connexion (dont Google), mot de passe oublié, suppression du compte ; onboarding ; comptes ; journal (saisie, édition, suppression, filtres, import CSV) ; séance du jour et séances ; Tradovate (connexion, synchro, déconnexion).
  2. Plans et argent : essai de 14 jours, checkout et portail Stripe, retour au gratuit, accès FREE / PREMIUM aux 4 points (landing, front, guard, cron), parrainage, ambassadeur, offre fondateur, codes partenaires.
  3. IA et rendez-vous automatiques : débrief hebdo, insights, score et série, analytics, calendrier éco, PDF ; push, e-mails, Discord ; crons.
  4. Admin et landing, plus le compte démo en lecture seule.
  - Transverse à chaque lot : droits (un utilisateur ne voit ni ne modifie les données d'un autre), états vides, messages d'erreur, affichage mobile.
- Hors périmètre, parce que déjà suivi ailleurs ou déjà en cours dans une autre session : #916, #956, #963 (Tradovate R/R, découpage, stratégies), #977 (démo le week-end), #952 et #262 (fichiers réels manquants), #866 (désinscription beta : `API_URL` posée par Greg, reste la vérification), #817 (pages légales, hors code : à Greg), #860 (p-ticket Tradovate : à faire seulement après une pénalité réelle observée, carte « En attente »), les idées et enhancements ouverts. Les bugs qu'on trouve dans ces zones sont ajoutés à leur ticket, pas corrigés ici.
- Limite : un correctif qui change un comportement visible lié au plan, à l'argent, aux textes légaux ou aux e-mails envoyés à de vrais utilisateurs remonte à Greg avant le commit.
- Rappels : lot 2, les 4 points du gating (`plans.md`) ; lot 4, l'admin n'a pas d'environnement dev (tests et banc local seulement) ; dans chaque lot, crons et e-mails excluent `isDemo`.
