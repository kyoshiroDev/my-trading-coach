une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature

---

Ticket #1228 (colonne « Idées features », projet n° 4) : payoutProgress ignore min_amount : payout déclaré atteint avec un profit de cycle trop faible. Texte du ticket : « La progression vers le payout peut être déclarée atteinte (et l'alerte « payout atteint » partir) alors que le profit du cycle est négatif ou sous `payout.min_amount` : `payoutProgress` ne lit pas `min_amount`. À faire : intégrer `min_amount` (profit du cycle disponible ≥ minimum de retrait) dans les conditions, avec test d'équivalence (agent instruments). »

Décision de périmètre du relecteur (2026-11-27, après l'arbitrage instruments), option (b) resserrée : champ catalogue optionnel `safety_net_basis: 'after_payout' | 'to_request'` ; `after_payout` → seuil = net + min_amount ; absent ou `to_request` → net seul (inchangé) ; branche sans net inchangée. Renseigné seulement pour les plans classés sans ambiguïté par leurs notes. Test d'équivalence sur tout le catalogue. Le reste en sous-issues (plans à relire Apex Intraday/EOD et Elite Trader Funding ; base retirable de la branche sans net ; Earn2Trade). PR en « Refs #1228 ».
