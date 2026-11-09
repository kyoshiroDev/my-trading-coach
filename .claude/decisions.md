# Décisions de Greg (lues par l'agent relecteur)

- 2026-11-09 : mini-graphiques des KPI du tableau de bord = vraies séries seulement : pas de sparkline sous Profit factor, barres réelles (trades par jour tradé) sous Trades pris, drawdown tracé « sous l'eau » (0 en haut, aire remplie depuis le haut). Aucun décor.
- 2026-11-09 : drawdown max (PROMPT-drawdown-max-par-trade) = plus grand écart sommet → creux qui suit, sur le P&L net cumulé après chaque trade clôturé (ordre de clôture, frais inclus), sur la période choisie (solde du début de période = premier sommet), comptes archivés exclus par défaut. Calcul unique `libs/shared/src/max-drawdown.ts` pour tous les écrans (tableau de bord, Statistiques, résumé API, sessions, seed démo). Trades du même instant = une seule étape (ordre inconnu, aucun creux inventé). Marge prop firm (règles du plan, EOD/intraday) : calcul séparé, non modifié.
- 2026-11-09 : la carte d'aperçu de `/prop-firm` reprend le libellé de l'app « Marge avant le plancher » (au lieu de « Il te reste avant la limite »), cohérent avec `contexte-com.md`.
- 2026-11-08 : le relecteur tranche seul les décisions de contenu (textes, accroches, déroulés de vidéo, formulations, choix d'une vue réelle à la place d'une vue absente) dans le cadre de `.claude/contexte-com.md` ; il rend une version complète prête à l'emploi. Restent à Greg : décisions business (prix, offre, essai, gratuit/Premium, CGU et textes légaux, mention NinjaTrader nouvelle, suppression de données, messages à de vrais utilisateurs, publication, dépense pub, périmètre) et tout ce qui touche à la prod.
- 2026-11-08 : tout prompt collé par Greg est enregistré tel quel dans `.claude/prompts/PROMPT-<nom>.md` et commité avec le travail (texte exact pour le relecteur).
- 2026-11-08 : `beta` n'est plus utilisée pour les fonctionnalités : tout part de `dev` et revient sur `dev`, puis `dev` → `main`.
- 2026-11-08 : sauvegardes sur serveur datées à la minute (`AAAAMMJJ-HHMM`), `cp -pn`, jamais un nom existant.
- 2026-11-08 : `/` redirige temporairement (302) vers `/prop-firm` ; ancienne accueil sur `/accueil` (noindex, hors sitemap). Noindex de `/prop-firm` et canonical à traiter dans la refonte de l'accueil vers le 15/11.
- 2026-11-08 : le bouton « Créer mon compte » de la démo mène à `/register` avec `source=demo` (branche fix/demo-cta-campagnes-test).
- 2026-11-08 : campagnes de test exclues par défaut des stats Acquisition (test-*, ami), interrupteur « Inclure les tests ».
- 2026-10-25 : 14 jours de Premium offerts à l'inscription, sans carte, puis gratuit ; plus d'essai Stripe ensuite ; réservation fondateur possible pendant l'essai, premier prélèvement à la fin de l'essai, place comptée dès la réservation.
- Offre fondateur : 29 €/mois ou 290 €/an à vie, 200 places, satisfait ou remboursé 14 jours, pas d'essai Stripe. Premium : 49 €/mois, 490 €/an. Valeurs uniquement depuis `@mtc/shared`.
- `/prop-firm` : ne jamais la supprimer ni changer son URL avant fin novembre 2026 (lien de la newsletter NinjaTrader).
- NinjaTrader : « Référencé dans l'écosystème NinjaTrader » (texte factuel), jamais « partenaire officiel », aucun autre courtier ou plateforme nommé, pas de « compatible NinjaTrader » avant un test réel sur un compte NinjaTrader live. Tradovate cité en texte seul, sans logo.
- Le partage de résultats met la discipline en avant ; le montant est masquable ; aucune promesse de gain.
- 2026-11-08 : les PR vers `dev` sont ouvertes par l'agent relecteur une fois tout validé et après le « OK push » de Greg ; la PR `dev` → `main` seulement sur demande de Greg. Greg lit et merge lui-même. Personne d'autre ne merge.
- Branches : tout part de `dev` et revient sur `dev`, puis `dev` → `main`. Merge commit, jamais squash. Aucun push sans « OK push ».
- Rien sur les VPS, la prod, Stripe live sans accord explicite de Greg. Les suppressions SQL en prod, Greg les lance lui-même.
