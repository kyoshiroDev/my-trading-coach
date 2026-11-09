# PROMPT — Comptes archivés cohérents partout (Journal : liste, en-têtes, barre de chiffres)

> Contexte : branche `fix/comptes-archives-coherents` (commit `971aaf55`). Prompt collé par Greg le 2026-11-09 (texte exact ci-dessous), suivi de ses réponses aux questions posées avant de coder.

MISSION : un compte archivé doit se comporter partout de la même façon. Aujourd'hui, dans le Journal, la barre de chiffres exclut les comptes archivés (bandeau "3 comptes exclus des chiffres : 3 archivés", interrupteur "Inclure les comptes échoués et archivés" éteint, 3 trades, -88,50 $) alors que la liste affiche leurs trades avec le badge "Archivé", et que les en-têtes de jour et de semaine les comptent (vendredi 6/11 : 5 trades, -621,06 $ ; semaine : +15 537,80 $ "partiel"). C'est trompeur pour l'utilisateur.

RÈGLES : branche fix/comptes-archives-coherents depuis origin/dev à jour, dans un worktree séparé. pnpm uniquement. Une seule suite lourde à la fois (2 workers), base locale dédiée. Commit conventionnel. Aucune modification de données, aucune migration, aucune prod. Aucun push sans mon "OK push" ; c'est moi qui ouvre la PR vers dev. Tout test qui fixe une date fige l'horloge.

1. INVENTAIRE d'abord (tableau avant de coder) : tous les écrans, endpoints et calculs qui lisent des trades ou des comptes : Journal (liste, en-têtes de jour et de semaine, barre de chiffres, compteur "N trades dans les chiffres", compteur "20+ trades" et l'étiquette "partiel"), Historique des sessions, Statistiques, Insights IA, Débrief hebdo, Score trader, tableau de bord, Calendrier, Session du jour, sélecteur de compte, export CSV, e-mails (récap du jour, premier récap de semaine), détecteurs de comportement, autopsie. Pour chacun : traite-t-il les comptes archivés, comment (exclus, inclus, badge), et l'écart avec la règle ci-dessous.
2. RÈGLE À APPLIQUER (sauf contradiction trouvée dans le code ou dans plans.md : dis-le-moi alors avant de coder) :
   - Par défaut, un compte archivé est HORS de tout : ses trades n'apparaissent ni dans la liste du Journal, ni dans les totaux de jour et de semaine, ni dans la barre de chiffres, ni dans les calculs des autres écrans et de l'IA.
   - Quand l'utilisateur allume "Inclure les comptes échoués et archivés", ses trades apparaissent avec le badge "Archivé" ET entrent dans tous les totaux (liste, en-têtes, barre) de façon cohérente.
   - Les chiffres de la liste, des en-têtes et de la barre se calculent à partir du MÊME jeu de trades, jamais de deux requêtes différentes.
   - Les trades d'un compte archivé restent consultables : depuis "Mes comptes" (ligne "Hors statistiques · N trades"), prévois un accès clair (lien qui ouvre le Journal filtré sur ce compte avec l'interrupteur allumé), sans changer le reste de l'écran.
   - Ne supprime jamais de données et ne réécris aucun texte d'IA stocké.
3. Corrige côté API (un filtre unique partagé, pas des copies) et côté app. Vérifie que la mention "partiel" et le compteur "20+ trades" restent justes avec le filtre.
4. TESTS : jeu de données qui reproduit mon cas (1 compte actif avec 3 trades du 6/11 : +447, -267,50, -268 ; 3 comptes archivés avec des trades). Attendus : interrupteur éteint = 3 trades dans la liste, en-tête du jour "3 trades -88,50 $", en-tête de semaine cohérent avec la barre de chiffres ; interrupteur allumé = tous les trades avec le badge et tous les totaux incluent les archivés. Test API (intégration) et test de composant. Même vérification sur au moins deux autres écrans de l'inventaire. Aucun appel réel à l'IA.
5. Captures avant / après du Journal (sans données personnelles) à 1440 et 390 px.

RAPPORT : inventaire, règle appliquée, écarts trouvés dans les autres écrans (corrigés ou non, et pourquoi), tests, commandes et résultats, état de la branche, ce que je dois vérifier à la main sur dev. Aucun push avant mon "OK push".

---

Réponses de Greg aux contradictions relevées avant de coder (choix exacts) :

- Règle #681 « la liste du Journal n'est PAS filtrée » : **Oui, remplacer**.
- Périmètre : **Échoués + archivés** (un seul filtre, un seul interrupteur).
- Base de comportement et alertes de tilt (comptent tous les comptes, exception documentée) : **Les laisser**.
- Autres écarts à corriger dans la branche : **Historique des sessions** et **Premier récap de semaine**.
