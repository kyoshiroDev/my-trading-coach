# PROMPT-858 : veille des règles, vérifications restantes (Lucid)

## Demande de Greg (2026-11-26)

« une fois la ci fini je veut que tu attaque la colonne idées features en commencant par la #1292 et pour remonter jusqu'a la #263 apres chaque feature fini tu push et ouvre la PR vers dev tu attend que la ci soit ok et tu enchaine avec l'autre feature »

## Ticket #858 : Veille des règles : compléter les vérifications restantes

Suite de la veille du 2026-11-02 (#653). Ces sources n'ont pas été relues : les plans concernés gardent les valeurs du dernier relevé.

À relire dans Chrome (sites illisibles hors navigateur), puis mettre à jour le JSON de la firm, `verified_at` et le champ `lectures` de `veille/sources.json` :

- [ ] **Phidias, avant le 2026-11-05** (`verified_at` du 2026-10-06, seuil des 30 jours) : pages horaires et news du centre d'aide, règles Fundamental et Premium (seul le comparatif du site a été vu).
- [ ] **Bulenox** : page Compte financé (https://bulenox.com/help-center/funded).
- [ ] **Lucid** : 63 plans sur 64 (seule la configuration 150K Pro avec DLL a été relue) ; prix des autres configurations.
- [ ] **Apex** : les 28 articles du centre d'aide (seuls l'accueil 25K Intraday et la page Legacy ont été relus).
- [ ] **Tradeify** : les 7 articles sur 13 non relus le 2026-11-02 (relus : prix, drawdown, perte journalière, payouts Select, Lightning et Growth).

Pas le label `veille-prop-firm` sur ce ticket : le workflow de veille commente l'issue ouverte qui le porte (#653).

### Commentaires du ticket

Veille des règles prop firm : les lots 1 à 5c sont terminés et mergés dans dev (détail dans #1218, fermée). Suites : #1238 (Topstep Static Combine), #1241 (Top One Elite ACCESS Static), #1242 (API : refuser un plan discontinued), #1244 et #1245 (sélecteur et bandeau « à revoir »), #1247 (gel au premier payout Topstep XFA et FFF Premier+), plus les blocages de drawdown à confirmer (Lucid Daily funded EOD, FFF Straight to Funded nouvelle version).

## Constat au départ (2026-11-28)

Phidias, Bulenox, Apex et Tradeify ont été relues en entier par les lots 1 à 3 de #1218 (`verified_at` du 22 et 23/11). Reste Lucid : `verified_at` du 2026-10-22 (37 jours, au-delà du seuil de 30), 63 configurations sans prix. Tri du relecteur du 26/11 : « Lucid via lot 653 ».
