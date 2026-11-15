# PROMPT — Dédoublonnage par compte, copy trading (#1001, sous-issue de #994)

## Demandes de Greg (2026-11-15, texte exact)

> pour le #1000 essaie de le faire toi même avec chrome et pour #1001 que dit le recteur

> suit les recommandations du relecteur

## Recommandation du relecteur retenue (option 3)

- Le même trade sur deux comptes = deux trades. Empreinte et contrôle par compte (import CSV et synchro), sans migration d'index ni réécriture des données prod (préfixe de compte sur l'empreinte, index `@@unique([userId, importHash])` inchangé).
- « Supprimer les doublons » par compte.
- N8 : refuser de relier un compte Tradovate déjà relié à un autre compte MTC du même trader : « Ce compte Tradovate est déjà relié à « {nom} ». »
- N7 : refuser de changer de compte broker quand le compte MTC contient déjà des trades synchronisés d'un autre compte broker : « Ce compte contient déjà les trades de {ancien}. Crée un compte pour {nouveau}. »
- Résultat d'import : « 12 trades existent aussi dans le compte « Apex 50k #1 » : importés ici aussi. »

## Comptage prod (lecture seule, 15/11)

1 trader avec des trades sur ≥ 2 comptes ; 0 paire de trades jumeaux entre deux comptes ; 0 compte Tradovate relié deux fois ; 0 trade sans compte.
