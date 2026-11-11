MISSION : le R/R des trades synchronisés Tradovate. Branche fix/rr-trades-synchronises depuis origin/dev à jour, worktree séparé, pnpm, une seule suite lourde à la fois (2 workers), base locale dédiée, tout test qui fixe une date fige l'horloge, commit conventionnel, aucune prod, aucune migration sans me la montrer, aucun push sans mon "OK push" (c'est moi qui ouvre la PR vers dev). Tradovate : LECTURE SEULE, jamais d'ordre (contrat NinjaTrader, clause 2i).

CONSTAT : dans le Journal, les trades synchronisés affichent un R/R de "0" avec l'info-bulle "Pourquoi le R:R vaut 0" alors que la valeur est null (journal.component.html, bloc td-rr). La synchro Tradovate n'écrit jamais stopLoss, takeProfit ni riskReward (grep vide dans integrations/tradovate). docs/tradovate-api-capabilities.md : historique des ordres lisible seulement en séance côté Trade API ; le rapport Reporting "Orders" porte Stop Price et Limit Price mais sans ocoId ni parentId.

PHASE 0 : mesure (lecture seule, aucun code de production)
1. Sur mon compte Lucid (5 trades : 3 le 6/11, 2 le 9/11 : MNQ 16:11 et MGC 08:16 heure de Paris), regarde si un stop et un objectif sont retrouvables chez Tradovate, par la voie directe (Trade API) et par le rapport Reporting "Orders" (champs Stop Price et Limit Price, liaison par compte, contrat, côté, fenêtre horaire du trade). N'utilise que mon compte, via la connexion de dev ou de test déjà autorisée dans l'environnement ; si aucune n'est disponible, dis-moi la procédure minimale, sans secret dans le chat, et attends. Ne touche pas à la prod.
2. Pour chaque trade : stop retrouvé oui/non, d'où, avec quelle certitude (unique ou ambigu), et le R/R que cela donnerait. Ne devine rien : "non retrouvé" est une réponse valable.
3. Dis aussi quels autres trades synchronisés (archivés ou non) auraient pu en avoir un, sur la base de ce que le rapport te donne.

PHASE 1 : correctifs sûrs (commits séparés)
a. Journal : remplace "0" par "—" quand riskReward est null ou absent, avec une info-bulle honnête ("Stop loss ou take profit non renseigné. Ajoute ton stop initial pour calculer le R/R."). Fais la même vérification sur tous les écrans qui affichent un R/R (tableau de bord, trades récents, session du jour, autopsie, e-mails, export CSV) : jamais 0 pour "inconnu".
b. Saisie rapide du stop initial sur un trade synchronisé : depuis la ligne du Journal, un champ simple (stop, et objectif en option) avec calcul en direct du R/R et du risque en dollars (utilise la table de valeur du point existante : MNQ 2 $, MES 5 $, NQ 20 $, ES 50 $, MGC 10 $, etc., et dis-moi si un instrument manque). Enregistre stopLoss, takeProfit et riskReward par la même logique que pour un trade saisi à la main (trade-metrics.util.ts). Vérifie que la note d'exécution comportementale se recalcule quand un stop est ajouté (behavioral-grades.ts) et que les trades synchronisés ne sont jamais écrasés par une resynchronisation (les champs saisis par l'utilisateur sont prioritaires).
c. Tests : affichage "—", calcul du R/R long et short, trade sans objectif, stop du mauvais côté (refusé avec un message clair), recalcul de la note, non-écrasement à la resynchronisation, moyenne de R/R qui ignore les inconnus.
d. Captures avant / après à 1440 et 390 px.

STOP APRÈS LA PHASE 1 : rapport avec la mesure de la phase 0 et tes recommandations. NE CODE PAS la capture en direct ni l'inférence après coup tant que je ne l'ai pas validée.

RAPPORT : résultat de la mesure (trade par trade), ce qui est corrigé, tests, commandes et résultats, état de la branche, ce que je dois vérifier à la main sur dev, écarts avec ce prompt. Aucun push avant mon "OK push".

---
COMPLÉMENT (Greg, 2026-11-10, après la phase 1 mergée en #919) :
valide la capture en direct à l'entrée
