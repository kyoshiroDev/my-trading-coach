# PROMPT-tradovate-sl-non-detectes-962

Pas de prompt collé : messages de Greg en session (texte exact).

12/11/2026 ~00:25 :
> aujourd'hui a l'instant le 12/11/2026 j'ai pris 2SL mais rien de detecter sur mon compte tahir.gregory@gmail.com en prod

12/11/2026 :
> oui ce sont mes 2 SL, rien dans le journal

12/11/2026, après rechargement :
> j'ai rechargé, toujours rien dans le journal pas RR

## Compléments (session du 12/11/2026)

- Étape 0 (lecture seule) : les 2 trades MGC LONG de 00:16 (−126 / −114) sont en base et dans le Journal, R/R « — » (stopLoss vide). Greg : « oui je les vois, R/R à — ». #962 fermée, rattachée à #955.
- Greg : « ok promotion dev → main en cours » (#961, diagnostic #957 en prod, `TRADOVATE_LINK_DIAGNOSTIC=true` déjà posé).
- Log « Liaison bracket Tradovate » du 12/11 : ni parentId, ni ocoId, ni linkedId ; chaque entrée et ses 2 jambes (une exécutée, une annulée) dans la même stratégie d'ordres (`orderStrategyLink`).
- #955 : « Ensuite : corriger la liaison sur le champ trouvé, et retirer le diagnostic. »
