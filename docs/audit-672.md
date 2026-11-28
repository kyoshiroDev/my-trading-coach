# Audit #672 : détecteur « stop éloigné pendant le trade » (E1)

## Constat

- Les versions d'un ordre arrivent par le WebSocket Tradovate (`TradovateLiveService.onOrder`, entité `orderVersion`). `applyOrderVersion` (`tradovate-orders.ts`) garde seulement la plus récente : la version précédente n'est disponible qu'avant cet appel.
- Position ouverte : Redis `tradovate:positions:<connexion>` (contrat, sens, prix moyen d'entrée, ouverture). Aucun prix courant par position.
- Latent : seulement `BrokerConnection.brokerOpenPnl`, au niveau du compte, rafraîchi par un appel REST au moment d'une synchro (fill), pas en direct. Le WebSocket ne pousse ni prix de marché ni P&L latent (lecture seule).

## Écart avec le ticket (tranché par le relecteur, 2026-11-28)

Le ticket demande « stop éloigné alors que le trade est en perte ». Le latent n'étant pas connu au moment où le stop bouge, le détecteur regarde le **risque** : un stop de sortie qui s'éloigne de l'entrée en finissant du côté perte augmente la perte maximale du trade, quel que soit le prix. Écarté : le latent du dernier fill (périmé, compte entier) et un appel REST à chaque déplacement (appel Tradovate en plus, interdit par la référence des détecteurs).

## Règle

- Ordre stop de **sortie** (`Stop`, `StopLimit`, `TrailingStop…` ; vente pour un LONG, achat pour un SHORT) sur le contrat d'une position ouverte.
- Comparaison ancienne / nouvelle version du même `orderId`, juste avant `applyOrderVersion` (`stopVersionChange`).
- Alerte si le nouveau stop est du côté perte de l'entrée **et** plus loin que l'ancien d'au moins `E1_MIN_TICKS` (2). Un ancien stop côté gain qui repasse côté perte compte.
- Rien : stop rapproché, stop qui reste côté gain (ou ramené à l'entrée), stop d'entrée (même sens que la position), première version vue d'un ordre.
- Une fois par position (`behavior:stop:<compte>:<contrat>:<ouverture>`, SET NX, 12 h) : un renfort qui change le prix moyen garde la même ouverture.
- Message factuel : « Stop éloigné de 6 ticks sur NQ (risque porté à 14 ticks). » Severity unique `medium` pendant la phase silencieuse.

## Fichiers

- `behavior/behavior-stop.ts` (pur) : `stopWidening`, `stopWidenedDraft` ; seuils dans `behavior.constants.ts`.
- `integrations/tradovate/tradovate-orders.ts` : `stopVersionChange` (pur).
- `integrations/tradovate/tradovate-live.service.ts` (`onOrder`) : appel avant `applyOrderVersion`, puis `BehaviorAlertsService.onStopMoved`.
- `behavior/behavior-alerts.service.ts` : `onStopMoved` (position Redis, détecteur, une fois par position, `BehaviorAlert`, mêmes interrupteurs `BEHAVIOR_ALERTS_RECORD` / `BEHAVIOR_ALERTS_UI`, hors démo).
- Démo : `admin/demo-data/stop-widened-example.ts` (pur, chargé sous tsx) et `demo-seed.ts` : une alerte E1 sur le dernier trade NQ perdant de l'Apex, invisible avant #671.

## Ouvert pour #671 (affichage)

- Gating (le ticket dit « Premium à valider ») : à trancher avec Greg à l'affichage.
- Seuils de gravité : à fixer avec les vraies alertes enregistrées.
