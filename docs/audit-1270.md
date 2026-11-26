# Étude · jauge de pression en séance (#1270, étape 1)

> **À lire d'abord : le jeu étudié ici est synthétique** (compte démo, généré en mémoire). Il
> vérifie la mécanique de la jauge ; il ne prouve **rien** sur son pouvoir prédictif. La vraie
> validation demande l'historique réel (export pseudonymisé en lecture seule, comme le rejeu #602),
> donc l'accord de Greg. Rien n'est affiché ni enregistré : aucune migration, aucune variable.

## Ce qui est fait

- **`pressureAt`** (`apps/api-mytradingcoach/src/modules/behavior/behavior-pressure.ts`, pur) : à chaque
  nouvelle entrée, un score de 0 à 100 et un état (calme, vigilance, zone rouge), **neutre tant que
  la référence est en apprentissage** (moins de 10 séances), comme B, C1 et C3.
- La jauge **agrège les mesures des détecteurs existants**, en continu au lieu d'un seuil tout ou
  rien, toujours contre la référence du trader :

  | Signal | Mesure | Points |
  |---|---|---|
  | Ré-entrée après une perte | délai / délai médian du trader après une perte : < 1/3, < 1/2, < 1 | 30, 20, 10 |
  | Taille | au-dessus de son p90 sur l'actif (juste après une perte) | 15 (25) |
  | Rythme | rang de la position au-delà de son p90 de positions par séance (1,5 × p90) | 15 (25) |
  | Pertes d'affilée | 2, 3, 4 et plus | 10, 20, 30 |
  | Perte max du jour | plus de 50 %, plus de 80 % consommés | 15, 30 |
  | Règles d'ailleurs | taille au-dessus du max du plan (A1), au-delà de la limite déclarée (C2) | 30, 15 |

  Calme sous 30, vigilance de 30 à 59, zone rouge à partir de 60, plafond 100. Toutes les valeurs
  sont dans `behavior.constants.ts` : ce sont des valeurs de départ, à régler sur l'historique réel.
- **Phrase factuelle** du coach : les deux signaux les plus lourds, par exemple « Entrée 2 min après
  une perte (d'habitude 37 min) ; 8 MNQ juste après une perte (d'habitude 4). » Jamais « émotion
  détectée », jamais de conseil.
- **Rejeu** : `replay` donne la jauge de chaque position, calculée sur les seules journées
  précédentes (test : ajouter des séances futures ne change rien). **`evaluatePressure`** mesure ce
  que la jauge annonce : P&L de la position et de la suite de la séance par état, pire position, et
  pires journées vues en zone rouge avant leur plus bas, comparées au taux de base.
- **Script** `apps/api-mytradingcoach/scripts/replay-pressure.ts` : `--demo` ou un dossier d'export au
  format #602 (`trades.jsonl`, `users.jsonl`). Lecture seule, aucune connexion à la base.

## Ce que montre la démo (mécanique seulement)

- La seule journée « revenge » du jeu passe en zone rouge, sur l'entrée qui la fait plonger ; aucune
  journée normale n'y passe. La vigilance précède des positions perdantes.
- 102 positions en tout : c'est très peu, et le générateur fabrique exprès ces journées. Aucun
  chiffre ci-dessous ne se transpose à un vrai trader.

## Limites connues

- **Heure d'entrée absente de l'historique** : l'entrée est datée de la première sortie (comme le
  rejeu #602). Le délai de ré-entrée est donc majoré et le signal sous-estimé au rejeu ; en direct,
  l'heure d'ouverture est connue, avec un biais vers plus de vigilance qu'au rejeu.
- **Sans plan relié, A1 et la perte max du jour sont muets** (1 compte sur 16 relié en prod au
  rapport #602).
- **Une alerte de risque n'est pas une prédiction de perte** : chez le seul trader à volume du
  rapport #602, se retourner en taille après une perte lui rapportait plus souvent que ça ne lui
  coûtait. Il faudra juger la jauge sur la dispersion (pire position, suite de la séance) autant que
  sur la moyenne, et accepter d'abandonner un signal qui n'apporte rien.
- Le stop déplacé (#672) et l'heure d'arrêt du contrat de session (#667) ne sont pas encore des
  signaux : ils s'ajouteront quand ces tickets seront faits.

## Suite proposée

1. **Validation sur l'historique réel** (accord de Greg) : export pseudonymisé en lecture seule,
   même procédure que #602, puis `replay-pressure.ts <dossier>` ; réglage des points et des seuils.
2. Étapes 2 à 4 du ticket (calcul en direct et stockage, jauge en Session live, courbe dans le
   débrief, seed démo, landing), seulement si l'étape 1 montre un pouvoir prédictif.

## Décisions pour Greg (avant l'étape 2)

1. Saisie manuelle de l'émotion : la retirer, ou la garder en option en un clic ?
2. Écrans qui l'utilisent (stats et heatmap par émotion, débrief de la semaine, prompts IA, seed
   démo, textes de la landing) : que deviennent-ils ?
3. Plan : FREE, PREMIUM, ou les deux ?
4. Accord pour l'export pseudonymisé de l'historique prod (lecture seule) qui valide la jauge.

## Annexe · sortie du script sur le jeu démo

102 lignes, 102 positions, 39 séances dont 29 hors apprentissage.

#### Par état à l’entrée

| État | Positions | P&L moyen | P&L médian | Perdantes | Pire position | Suite de la séance (moyenne) |
|---|---|---|---|---|---|---|
| Apprentissage | 28 | −10 $ | −11 $ | 50 % | −295 $ | −47 $ |
| Calme | 71 | +29 $ | +23 $ | 44 % | −205 $ | +47 $ |
| Vigilance | 2 | −105 $ | −105 $ | 50 % | −342 $ | −283 $ |
| Zone rouge | 1 | −250 $ | −250 $ | 100 % | −250 $ | −250 $ |

#### Par séance

- Séances qui atteignent la zone rouge : 3 % des séances notées (taux de base).
- Pires journées (décile bas du plus bas intrajournalier) : 3 ; en zone rouge : 1 ; zone rouge au plus tard à leur plus bas : 1.

#### Signaux (nombre d’entrées où le signal compte)

| fast_reentry | size_up | pace | loss_streak | daily_loss_used | over_plan | over_limit |
|---|---|---|---|---|---|---|
| 10 | 2 | 3 | 3 | 0 | 0 | 0 |

#### Démo : zone rouge par type de journée générée

| Type | Séances notées | En zone rouge |
|---|---|---|
| normal | 18 | 0 |
| revenge | 1 | 1 |
| secondary | 8 | 0 |
| today | 1 | 0 |
| yesterday | 1 | 0 |

#### Exemples de zone rouge (1 sur 1)

- 2026-11-18, position 3/3, score 65 : Entrée 2 min après une perte (d'habitude 37 min) ; 8 MNQ juste après une perte (d'habitude 4). Position −250 $, suite de la séance −250 $.
