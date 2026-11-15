# PROMPT — Bouton d'inscription dans la démo + campagnes de test exclues des stats

> **Contexte (mis à jour le 15/11).** La newsletter NinjaTrader n'est pas encore partie (date à confirmer). Sur les 30 derniers jours, Admin > Acquisition montre :
> - **Démo : 127 ouvertures, 0 clic sur « Créer mon compte ».** Les visiteurs explorent la démo et repartent sans jamais voir de raison claire de s'inscrire. Le bouton actuel « Créer mon compte gratuit » mène à `landingUrl + '/#pricing'`, une ancre qui n'existe plus depuis la redirection de l'accueil vers `/prop-firm`.
> - Les campagnes de test (`test-greg`, `test-greg4`, `test-prod-essai`, `ami`…) et les comptes de test se mélangent aux vraies sources : 7 « inscrits » affichés pour 1 seul vrai.
>
> Deux correctifs courts, à livrer **avant l'envoi**. L'inscription, l'essai de 14 jours et les e-mails sont déjà testés : n'y touche pas.
>
> Branche `fix/demo-cta-campagnes-test` depuis `origin/dev` à jour, dans un worktree séparé, livrée sur `dev`.

## Règles de travail
- Enregistre ce prompt dans `.claude/prompts/demo-cta-et-campagnes-test.md`.
- **Agent `relecteur` obligatoire** : à chaque arrêt, il relit le diff réel et répond aux questions de détail. Le travail doit être **validé à 100 %** par lui (prompt complet, règles, tests au vert, captures, aucun conflit, aucune question ouverte pour moi). Une fois validé à 100 % : push de la branche, PR vers `dev` ouverte par le relecteur, suivi de la CI jusqu'au vert. Je merge moi-même.
- Lis `CLAUDE.md`, `angular.md`, `design.md`, `plans.md`, `nestjs.md` (événements d'acquisition), `tests.md`, et `admin-mytradingcoach.html` avant de toucher à l'admin.
- Textes d'offre et durée d'essai depuis `@mtc/shared` (`PREMIUM_SIGNUP_TRIAL_DAYS`, constantes de l'offre), jamais en dur.
- Tokens de `theme.css`, CSS dans les `.css`, `@if` / `@for`, `pnpm` uniquement.
- Commits atomiques `fix(app):`, `fix(api):`, `fix(admin):`, `test(...):`, `docs(agents):`. **Rien sur les VPS ni la prod. Jamais de push direct sur `dev` ou `main`.**

## Étape 0 — Rapport court avant de coder (arrêt)
1. Où se trouve aujourd'hui le bouton « Créer mon compte » de la démo (composant, place à l'écran sur mobile et ordinateur) et l'événement qui compte ses clics.
2. Comment la démo est ouverte (`/demo`, `?internal=1`) et si les ouvertures avec `internal=1` sont bien exclues du compteur des 127.
3. Comment l'admin Acquisition identifie une source ou une campagne, et où sont marqués les comptes de test, démo et admin (`isDemo`, rôle, liste d'e-mails ?).
4. La liste exacte des campagnes et sources de test visibles en prod sur 30 jours (lecture seule).

**Arrêt après le rapport** : le relecteur le valide et tranche les questions de détail ; il ne me remonte que ce qui me revient (décision business, prod). Puis étape 1.

## Étape 1 — Bandeau d'inscription permanent dans la démo
- Un bandeau **fixe en bas de l'écran**, visible sur toutes les pages de la démo, sur mobile et ordinateur, qui ne cache aucun bouton de l'app (ajoute la marge nécessaire au contenu, et respecte la zone sûre en bas sur iPhone).
- Texte : « Ça te parle ? Crée ton compte : **{N} jours de Premium offerts**, sans carte » avec un bouton « Créer mon compte ». `{N}` = `PREMIUM_SIGNUP_TRIAL_DAYS`.
- Le bouton mène à `/register` en gardant les paramètres d'origine de la visite (UTM de la newsletter, `ref`), avec `source=demo` pour distinguer ces inscriptions.
- Une croix permet de le réduire en une petite pastille « Créer mon compte », qui reste visible ; il réapparaît en grand à la page suivante.
- **Une seule relance** : après 60 secondes dans la démo **ou** 3 pages vues, une fenêtre courte et honnête : « Tu as vu l'essentiel. Avec ton compte, tu connectes ton Tradovate en lecture seule et tu suis ta marge en direct. » Boutons « Créer mon compte » et « Continuer la démo ». Une seule fois par visite, jamais pendant que l'utilisateur fait défiler une liste ou remplit un champ.
- Événements : `demo_cta_view`, `demo_cta_click` (avec `placement` : `banner`, `pill`, `modal`), `demo_modal_shown`, sur le modèle des événements existants, sans donnée personnelle. Le compteur actuel de clics « Créer mon compte » de la démo doit compter ces clics.
- Aucune promesse de gain, aucun prix dans le bandeau.

## Étape 2 — Campagnes et comptes de test exclus des statistiques
- Dans l'admin Acquisition, **par défaut**, exclure des chiffres (visites, entonnoir, inscrits, engagement) :
  - les campagnes et sources de test listées à l'étape 0 (`test-*`, `ami`, et toute autre que je valide) ;
  - les comptes démo, admin et de test déjà marqués.
- Une seule liste de motifs, dans une constante ou une configuration documentée (pas dispersée dans les requêtes), pour que j'ajoute facilement une future campagne de test.
- Un interrupteur « Inclure les tests » dans l'admin pour revoir les chiffres bruts.
- Les données ne sont pas supprimées : on filtre à l'affichage ou dans les requêtes.
- Vérifie que la ligne `ninjatrader · newsletter` s'affiche correctement à part.

## Vérifications (arrêt pour captures)
- Captures 390 et 1440 px : bandeau sur le tableau de bord, la séance et le journal de la démo ; pastille réduite ; fenêtre de relance.
- Clic sur le bouton depuis une URL avec les UTM de la newsletter : `/register` les garde, et `source=demo` est présent.
- Admin Acquisition avec et sans « Inclure les tests » : chiffres avant et après, côte à côte.
- Tests unitaires : affichage du bandeau, réduction en pastille, relance une seule fois (60 s ou 3 pages), filtre des campagnes de test, interrupteur.
- Lint, typecheck, tests unitaires et e2e de l'app, de l'API et de l'admin au vert.
- Mets à jour `angular.md` (bandeau démo) et `nestjs.md` (événements, filtre des tests).
- Validation à 100 % par le relecteur, puis push et PR vers `dev`. **Stop après la PR** : je lis et je merge.
