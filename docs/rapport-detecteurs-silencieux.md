# Rapport · détecteurs de comportement en mode silencieux (phase 1)

> Issue #602. Rejeu du 2026-10-18 sur la base **prod**, lue avec le rôle en lecture seule, export
> pseudonymisé à la source (empreintes md5 tronquées) et gardé hors du dépôt. Traders nommés A, B, C
> par volume décroissant ; aucun identifiant, e-mail ni nom ici. Seuils : `behavior.constants.ts`.
> Méthode et limites des données : `docs/audit-detecteurs-comportement.md`.

## Synthèse

- **Volume : dans la cible.** 0,6 à 1,05 alerte par séance en moyenne (objectif ≤ 2 à 3), p90 ≤ 2,6.
  Aucun ajustement nécessaire pour le volume.
- **Seuls 3 traders ont ≥ 10 séances en prod**, et un seul a des données réelles de futures en
  volume (A, le scalper). B saisit à la main de petites positions crypto (P&L de quelques dollars),
  C a surtout des trades de test (dont un BTC/USD à +15 000 $). Les chiffres de B et C ne disent
  presque rien ; tout ce qui suit repose sur A, soit **65 séances exploitables : c'est peu**.
- **A (règles prop firm) n'a rien pu montrer** : aucun compte de A ni de B n'est relié à un plan du
  catalogue, et le seul compte relié (C, Apex EOD 50k, perte max du jour 1 000 $) ne porte qu'une
  séance de 2 trades gagnants en 1 contrat : la règle était connue (« 1 séance avec règle », § 3),
  mais aucune perte ni aucune taille ne permettait de la tester. A1/A2/A3 sont testés unitairement,
  pas sur données réelles. (Corrigé le 2026-10-18, #612 : la première version disait à tort que ce
  plan n'avait pas de perte max du jour au catalogue.)
- **Le « scalper qui enchaîne » ne déclenche pas B** : les séances rapides sans autre signal restent
  muettes (B = 0,51 par séance chez A, quasi toujours avec taille + retournement).
- **Le chiffre qui compte est mitigé, et c'est la vraie information** :
  - C1 (3 pertes d'affilée puis nouvelle entrée) isole bien les mauvais trades : médiane −65 $
    contre +11 $, 60 % perdants contre 28 %. Mais 5 cas seulement.
  - Les **mauvaises journées** de A (10 % les plus profondes) ont été **précédées d'une alerte 3 fois
    sur 4**, pour un taux de base de 35 % des séances. Signal encourageant, sur 4 journées.
  - **B et C3 ne prédisent pas une perte chez A** : positions alertées à +109 $ / +124 $ en moyenne
    (médianes +39 $ / +23 $) contre +27 $ pour les autres ; elles perdent plus souvent (36-43 %
    contre 27 %) mais gagnent plus gros. Chez ce trader, se retourner en taille après une perte fait
    partie de sa façon de trader, et ça lui rapporte plus souvent que ça ne lui coûte. 25 des 42
    alertes B (60 %) finissent gagnantes jusqu'à la fin de la séance.

## Propositions de seuils

1. **B, signal « taille »** : `taille > max(p90, 2 × médiane)` au lieu de `> p75`. Chez un scalper
   à 1 contrat, le p75 vaut 1 : toute position de 2 contrats comptait comme un signal. Rejoué
   (§ 5) : A passe de 33 à 24 alertes B, B de 9 à 7. **Ne change pas la conclusion** (les alertes
   restantes restent gagnantes en moyenne).
2. **C3** : exiger aussi `taille > p90 du trader` (30 → 18 chez A). Même remarque.
3. **Ne pas monter B en sévérité haute sur « 3 signaux »** tant qu'on n'a pas de meilleure preuve :
   l'exemple du 19/08 (5 contrats perdants moyennés, puis retournement en 120 contrats sur un compte
   funded, +2 871 $) est exactement le comportement visé et le plus gros gain de la période.
   Dire « attention » sur un tel trade est juste sur le risque, mais le trader le vivra comme faux.
4. Garder C1 et C2 tels quels.

Je n'ai **pas** appliqué ces seuils : ils restent à valider. Les constantes actuelles sont celles du prompt.

## Ce qui me paraît faux ou fragile

- **Mesurer B et C3 au résultat est trompeur** : une alerte de risque n'est pas une prédiction de
  perte. Il faudrait juger sur la **dispersion** (taille du pire cas, distance à la perte max du jour),
  pas sur le P&L moyen. D'où l'intérêt de A2 : il parle en points avant la coupure, pas en morale.
- **A est aveugle sans plan relié** (1 compte sur 16 en prod). Sans rattachement au catalogue, le
  cœur du positionnement « protéger le compte prop firm » ne s'allume jamais.
- **Heure d'entrée absente** : sur l'historique, l'entrée est datée de la première sortie ; le délai
  de ré-entrée est donc majoré, et le signal « ré-entrée rapide » sous-estimé. En direct, l'heure
  d'ouverture est connue mais comparée à une référence mesurée de sortie à sortie : **biais vers plus
  d'alertes B en direct qu'au rejeu**. À corriger avec `Trade.openedAt` (cf. audit).
- **Taille d'une position reconstituée** = contrats sortis : un trader qui renforce puis allège
  plusieurs fois a une « taille » gonflée. Cohérent entre référence et évaluation (le trader est
  comparé à lui-même), mais pas une taille de position au sens broker.
- **Anomalie de données** : une ligne de 145 MNQ pour 1 $ de P&L (07/08) ; exclue de la référence,
  elle reste dans le contexte d'un exemple.
- **Échantillon** : un seul vrai trader. Avant l'UI, il faut la semaine d'enregistrement silencieux
  sur beta (étape 4), et idéalement 2 ou 3 traders de plus.

<!-- Généré par apps/api-mytradingcoach/scripts/replay-behavior-alerts.ts : ne pas éditer à la main. -->

## Périmètre

| Trader | Lignes | Positions | Séances | Séances avec référence fiable (≥ 10) | Comptes reliés à un plan | Limite déclarée / jour | Style |
|---|---|---|---|---|---|---|---|
| Trader A | 948 | 476 | 75 | 65 | 0 | 100 | SCALPING |
| Trader B | 122 | 116 | 39 | 29 | 0 | 5 | DAY_TRADING |
| Trader C | 36 | 33 | 13 | 3 | 1 | 3 | DAY_TRADING |

## 1. Alertes par séance

Moyenne / p90 / max d’alertes par séance (toutes séances, y compris la période d’apprentissage).

| Trader | Toutes | A1_SIZE_OVER_PLAN | A2_DAILY_LOSS_DISTANCE | A3_ENTRY_DAY_STARTED | B_REVENGE | C1_LOSS_STREAK | C2_OVER_DAILY_LIMIT | C3_MARTINGALE |
|---|---|---|---|---|---|---|---|---|
| Trader A | 0,91 / 2,6 / 9 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,44 / 1,0 / 5 | 0,07 / 0,0 / 1 | 0,00 / 0,0 / 0 | 0,40 / 1,0 / 4 |
| Trader B | 0,62 / 2,2 / 5 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,23 / 1,0 / 1 | 0,08 / 0,0 / 1 | 0,26 / 1,0 / 5 | 0,05 / 0,0 / 1 |
| Trader C | 0,31 / 1,0 / 2 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,00 / 0,0 / 0 | 0,31 / 1,0 / 2 | 0,00 / 0,0 / 0 |

Sur les seules séances à référence fiable (B, C1, C3 actifs) :

| Trader | Séances | Toutes | B | C1 | C2 | C3 |
|---|---|---|---|---|---|---|
| Trader A | 65 | 1,05 | 0,51 | 0,08 | 0,00 | 0,46 |
| Trader B | 29 | 0,66 | 0,31 | 0,10 | 0,17 | 0,07 |
| Trader C | 3 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |

## 2. Exemples (5 par détecteur)

Contexte : 2 positions avant, la position alertée (→), 2 après. Heure de Paris, P&L net.

### A1_SIZE_OVER_PLAN (0 au total)

Aucune alerte.

### A2_DAILY_LOSS_DISTANCE (0 au total)

Aucune alerte.

### A3_ENTRY_DAY_STARTED (0 au total)

Aucune alerte.

### B_REVENGE (42 au total)

- **Trader A**, ven. 07/08 15:45:47 : « Nouvelle entrée MNQ : 3 s après la perte (d'habitude 6 min), 5 contrats (d'habitude 1), sens inversé sur le même actif. » (high)
  - 15:45:44 MNQ SHORT ×145 : −74 $
  - → 15:45:47 MNQ LONG ×5 : −46 $
  - suite de la séance à partir de l’alerte : −46 $

- **Trader A**, mer. 19/08 15:49:11 : « Nouvelle entrée MNQ : 120 contrats (d'habitude 1), sens inversé sur le même actif, après 2 pertes d’affilée. » (high)
  - 15:40:48 MNQ LONG ×1 : −246 $
  - 15:49:04 MNQ LONG ×5 : −1325 $
  - → 15:49:11 MNQ SHORT ×120 : +2871 $
  - suite de la séance à partir de l’alerte : +2871 $

- **Trader A**, mar. 29/09 13:09:18 : « Nouvelle entrée MNQ : 10 contrats (d'habitude 1), sens inversé sur le même actif. » (medium)
  - 13:09:00 MNQ LONG ×10 : −164 $
  - → 13:09:26 MNQ SHORT ×10 : +228 $
  - 13:19:05 MNQ LONG ×1 : +27 $
  - 15:02:26 MNQ LONG ×2 : −20 $
  - suite de la séance à partir de l’alerte : +990 $

- **Trader A**, ven. 02/10 15:39:59 : « Nouvelle entrée MNQ : 4 s après la perte (d'habitude 20 s), après 2 pertes d’affilée. » (medium)
  - 15:39:52 MNQ LONG ×1 : −42 $
  - 15:39:55 MNQ LONG ×1 : −27 $
  - → 15:39:59 MNQ LONG ×1 : +42 $
  - 15:57:40 MNQ LONG ×1 : +115 $
  - 15:57:49 MNQ LONG ×1 : +7 $
  - suite de la séance à partir de l’alerte : +509 $

- **Trader A**, ven. 09/10 15:21:43 : « Nouvelle entrée MNQ : 9 contrats (d'habitude 1), sens inversé sur le même actif, après 2 pertes d’affilée. » (high)
  - 15:00:29 MNQ SHORT ×2 : −170 $
  - 15:00:52 MNQ LONG ×8 : −154 $
  - → 15:22:25 MNQ SHORT ×9 : −67 $
  - 15:25:26 MNQ SHORT ×9 : +294 $
  - 15:26:24 MNQ LONG ×3 : −61 $
  - suite de la séance à partir de l’alerte : +491 $

### C1_LOSS_STREAK (8 au total)

- **Trader A**, mar. 18/08 17:22:30 : « Nouvelle entrée après 3 pertes d’affilée dans la séance. » (high)
  - 17:05:44 MNQ LONG ×1 : −20 $
  - 17:10:05 MNQ LONG ×5 : −699 $
  - → 17:22:30 MNQ SHORT ×16 : −988 $
  - 17:24:01 MNQ LONG ×134 : +1927 $
  - suite de la séance à partir de l’alerte : +939 $

- **Trader A**, ven. 25/09 15:45:32 : « Nouvelle entrée après 3 pertes d’affilée dans la séance. » (high)
  - 15:43:49 MNQ LONG ×16 : −912 $
  - 15:45:04 MNQ SHORT ×9 : −500 $
  - → 15:45:32 MNQ LONG ×11 : −311 $
  - suite de la séance à partir de l’alerte : −311 $

- **Trader A**, mer. 07/10 15:44:43 : « Nouvelle entrée après 3 pertes d’affilée dans la séance. » (high)
  - 15:44:19 MNQ LONG ×1 : −68 $
  - 15:44:24 MNQ LONG ×1 : −77 $
  - → 15:44:43 MNQ LONG ×1 : −65 $
  - 15:48:01 MNQ LONG ×10 : −509 $
  - 15:49:19 MNQ SHORT ×25 : −1398 $
  - suite de la séance à partir de l’alerte : −1972 $

- **Trader A**, jeu. 08/10 16:04:40 : « Nouvelle entrée après 3 pertes d’affilée dans la séance. » (high)
  - 16:03:57 MNQ LONG ×8 : −33 $
  - 16:04:22 MNQ SHORT ×20 : −451 $
  - → 16:05:56 MNQ LONG ×20 : +179 $
  - 16:06:09 MNQ LONG ×4 : +194 $
  - 16:07:20 MNQ LONG ×4 : +205 $
  - suite de la séance à partir de l’alerte : +615 $

- **Trader A**, ven. 09/10 15:22:29 : « Nouvelle entrée après 3 pertes d’affilée dans la séance. » (high)
  - 15:00:52 MNQ LONG ×8 : −154 $
  - 15:22:25 MNQ SHORT ×9 : −67 $
  - → 15:25:26 MNQ SHORT ×9 : +294 $
  - 15:26:24 MNQ LONG ×3 : −61 $
  - 15:28:10 MNQ SHORT ×17 : +205 $
  - suite de la séance à partir de l’alerte : +558 $

### C2_OVER_DAILY_LIMIT (14 au total)

- **Trader B**, mer. 01/07 15:36:19 : « 6e position de la séance, ta limite déclarée est de 5 par jour. » (medium)
  - 14:24:15 BTC/USDT LONG ×0.015 : +0 $
  - 15:13:59 BTC/USDT LONG ×0.02 : −0 $
  - → 15:36:19 BTC/USDT LONG ×0.02 : +0 $
  - 16:55:40 GOLD(XAU)/USDT SHORT ×0.3 : +0 $
  - 17:37:06 BTC/USDT LONG ×0.01 : +0 $
  - suite de la séance à partir de l’alerte : +4 $

- **Trader B**, mer. 01/07 17:37:06 : « 8e position de la séance, ta limite déclarée est de 5 par jour. » (medium)
  - 15:36:19 BTC/USDT LONG ×0.02 : +0 $
  - 16:55:40 GOLD(XAU)/USDT SHORT ×0.3 : +0 $
  - → 17:37:06 BTC/USDT LONG ×0.01 : +0 $
  - 22:48:31 HYPE/USDT LONG ×8 : −4 $
  - 23:46:08 HYPE/USDT SHORT ×8 : +7 $
  - suite de la séance à partir de l’alerte : +3 $

- **Trader B**, mer. 01/07 23:46:08 : « 10e position de la séance, ta limite déclarée est de 5 par jour. » (medium)
  - 17:37:06 BTC/USDT LONG ×0.01 : +0 $
  - 22:48:31 HYPE/USDT LONG ×8 : −4 $
  - → 23:46:08 HYPE/USDT SHORT ×8 : +7 $
  - suite de la séance à partir de l’alerte : +7 $

- **Trader B**, ven. 28/08 22:10:06 : « 6e position de la séance, ta limite déclarée est de 5 par jour. » (medium)
  - 19:36:38 SOL/USDT SHORT ×10 : +0 $
  - 20:39:28 PUMP/USDT SHORT ×1000 : +9 $
  - → 22:10:06 XRP/USDT SHORT ×350 : −3 $
  - 23:48:58 SOL/USDT LONG ×70 : −4 $
  - suite de la séance à partir de l’alerte : −7 $

- **Trader B**, dim. 30/08 21:02:11 : « 6e position de la séance, ta limite déclarée est de 5 par jour. » (medium)
  - 16:10:03 BTC/USDT LONG ×0.012 : +7 $
  - 20:05:31 XRP/USDT LONG ×500 : +0 $
  - → 21:02:11 SOL/USDT LONG ×5 : +1 $
  - suite de la séance à partir de l’alerte : +1 $

### C3_MARTINGALE (32 au total)

- **Trader A**, ven. 07/08 15:57:13 : « 17 MNQ après une perte à 3 contrats sur le même actif. » (high)
  - 15:49:37 MNQ LONG ×1 : +55 $
  - 15:57:05 MNQ LONG ×3 : −404 $
  - → 15:58:43 MNQ SHORT ×17 : +451 $
  - 16:02:02 MNQ SHORT ×1 : +63 $
  - 16:08:20 MNQ SHORT ×1 : −19 $
  - suite de la séance à partir de l’alerte : +607 $

- **Trader A**, mer. 19/08 15:49:04 : « 5 MNQ après une perte à 1 contrats sur le même actif. » (high)
  - 15:40:48 MNQ LONG ×1 : −246 $
  - → 15:49:04 MNQ LONG ×5 : −1325 $
  - 15:49:11 MNQ SHORT ×120 : +2871 $
  - suite de la séance à partir de l’alerte : +1546 $

- **Trader A**, ven. 25/09 15:43:49 : « 16 MNQ après une perte à 4 contrats sur le même actif. » (high)
  - 15:41:18 MNQ SHORT ×4 : −331 $
  - → 15:43:49 MNQ LONG ×16 : −912 $
  - 15:45:04 MNQ SHORT ×9 : −500 $
  - 15:45:32 MNQ LONG ×11 : −311 $
  - suite de la séance à partir de l’alerte : −1723 $

- **Trader A**, mer. 30/09 18:57:12 : « 23 MNQ après une perte à 4 contrats sur le même actif. » (high)
  - 18:53:38 MNQ SHORT ×4 : +8 $
  - 18:55:21 MNQ SHORT ×4 : −22 $
  - → 18:57:23 MNQ LONG ×23 : +31 $
  - 18:57:54 MNQ LONG ×4 : +87 $
  - 19:02:40 MNQ LONG ×1 : +5 $
  - suite de la séance à partir de l’alerte : +123 $

- **Trader A**, mer. 07/10 15:48:01 : « 10 MNQ après une perte à 1 contrats sur le même actif. » (high)
  - 15:44:24 MNQ LONG ×1 : −77 $
  - 15:44:43 MNQ LONG ×1 : −65 $
  - → 15:48:01 MNQ LONG ×10 : −509 $
  - 15:49:19 MNQ SHORT ×25 : −1398 $
  - suite de la séance à partir de l’alerte : −1907 $

## 3. Le chiffre qui compte

P&L net moyen de la position prise sur l’alerte (l’entrée qui la déclenche) contre les autres positions.

| Trader | Détecteur | Positions alertées | P&L moyen / médian alertées | Pire alertée | Autres positions | P&L moyen / médian autres | Pire autre | Part perdante alertées | Part perdante autres |
|---|---|---|---|---|---|---|---|---|---|
| Trader A | TOUTES | 45 | +173 $ / +27 $ | −1325 $ | 431 | +18 $ / +11 $ | −2224 $ | 40 % | 27 % |
| Trader A | B_REVENGE | 33 | +109 $ / +39 $ | −988 $ | 443 | +27 $ / +11 $ | −2224 $ | 36 % | 27 % |
| Trader A | C1_LOSS_STREAK | 5 | −178 $ / −65 $ | −988 $ | 471 | +35 $ / +11 $ | −2224 $ | 60 % | 28 % |
| Trader A | C3_MARTINGALE | 30 | +124 $ / +23 $ | −1325 $ | 446 | +27 $ / +11 $ | −2224 $ | 43 % | 27 % |
| Trader B | TOUTES | 22 | −1 $ / +0 $ | −6 $ | 94 | +1 $ / +0 $ | −9 $ | 45 % | 47 % |
| Trader B | B_REVENGE | 9 | −1 $ / −2 $ | −6 $ | 107 | +1 $ / +0 $ | −9 $ | 56 % | 46 % |
| Trader B | C1_LOSS_STREAK | 3 | −1 $ / +0 $ | −3 $ | 113 | +1 $ / +0 $ | −9 $ | 33 % | 47 % |
| Trader B | C2_OVER_DAILY_LIMIT | 10 | −1 $ / +0 $ | −4 $ | 106 | +1 $ / +0 $ | −9 $ | 40 % | 47 % |
| Trader B | C3_MARTINGALE | 2 | −3 $ / −3 $ | −4 $ | 114 | +1 $ / +0 $ | −9 $ | 100 % | 46 % |
| Trader C | TOUTES | 4 | −3 $ / −9 $ | −11 $ | 29 | +1268 $ / +0 $ | −47 $ | 75 % | 48 % |
| Trader C | C2_OVER_DAILY_LIMIT | 4 | −3 $ / −9 $ | −11 $ | 29 | +1268 $ / +0 $ | −47 $ | 75 % | 48 % |

Mauvaises journées précédées d’au moins une alerte (alerte AVANT le point bas de la journée) :

Taux de base : part de TOUTES les séances du trader avec au moins une alerte.

| Trader | Définition | Journées | Précédées d’une alerte | Journées sans alerte du tout | Taux de base |
|---|---|---|---|---|---|
| Trader A | perte max du plan atteinte ou > 80 % (0 séances avec règle) | 0 | 0 | 0 | 35 % |
| Trader A | 10 % de séances au plus bas intrajournalier le plus profond (≤ −1937 $) | 4 | 3 | 1 | 35 % |
| Trader B | perte max du plan atteinte ou > 80 % (0 séances avec règle) | 0 | 0 | 0 | 31 % |
| Trader B | 10 % de séances au plus bas intrajournalier le plus profond (≤ −10 $) | 3 | 2 | 0 | 31 % |
| Trader C | perte max du plan atteinte ou > 80 % (1 séances avec règle) | 0 | 0 | 0 | 23 % |
| Trader C | 10 % de séances au plus bas intrajournalier le plus profond (≤ −16 $) | 1 | 0 | 1 | 23 % |

## 4. Faux positifs probables (B)

Alertes B dont la position alertée ET la suite de la séance finissent gagnantes.

- Trader A, ven. 07/08 15:57:13 : fast_reentry + size_above_p75 + flip ; position +451 $, suite +607 $
- Trader A, ven. 07/08 16:41:53 : fast_reentry + size_above_p75 + flip ; position +350 $, suite +350 $
- Trader A, mer. 12/08 15:31:07 : fast_reentry + second_loss ; position +1 $, suite +327 $
- Trader A, mer. 19/08 15:49:11 : size_above_p75 + flip + second_loss ; position +2871 $, suite +2871 $
- Trader A, lun. 24/08 15:45:00 : size_above_p75 + flip ; position +493 $, suite +792 $
- Trader A, lun. 21/09 15:54:45 : size_above_p75 + flip ; position +476 $, suite +1154 $
- Trader A, lun. 21/09 16:15:58 : size_above_p75 + flip ; position +198 $, suite +198 $
- Trader A, jeu. 24/09 15:41:48 : fast_reentry + second_loss ; position +39 $, suite +107 $
- Trader A, lun. 28/09 16:25:58 : size_above_p75 + flip ; position +27 $, suite +27 $
- Trader A, mar. 29/09 13:09:18 : size_above_p75 + flip ; position +228 $, suite +990 $
- Trader A, mar. 29/09 15:02:48 : size_above_p75 + second_loss ; position +41 $, suite +760 $
- Trader A, mar. 29/09 15:34:49 : size_above_p75 + flip ; position +476 $, suite +705 $
- Trader A, mar. 29/09 15:55:52 : size_above_p75 + flip ; position +263 $, suite +346 $
- Trader A, mar. 29/09 17:31:12 : fast_reentry + size_above_p75 ; position +1 $, suite +119 $
- Trader A, mer. 30/09 18:57:12 : size_above_p75 + flip ; position +31 $, suite +123 $
- Trader A, mer. 30/09 14:36:09 : size_above_p75 + flip + second_loss ; position +216 $, suite +216 $
- Trader A, ven. 02/10 14:38:21 : size_above_p75 + flip ; position +143 $, suite +207 $
- Trader A, ven. 02/10 15:39:59 : fast_reentry + second_loss ; position +42 $, suite +509 $
- Trader A, mar. 06/10 14:30:50 : size_above_p75 + flip ; position +76 $, suite +2217 $
- Trader A, mar. 06/10 15:36:22 : size_above_p75 + flip ; position +178 $, suite +375 $
- Trader A, mar. 06/10 15:51:44 : size_above_p75 + second_loss ; position +763 $, suite +776 $
- Trader B, lun. 03/08 22:45:49 : flip + second_loss ; position +1 $, suite +7 $
- Trader B, dim. 16/08 23:19:13 : fast_reentry + size_above_p75 + second_loss ; position +0 $, suite +0 $
- Trader B, lun. 17/08 20:23:23 : fast_reentry + size_above_p75 ; position +10 $, suite +15 $
- Trader B, dim. 23/08 20:15:38 : size_above_p75 + flip ; position +0 $, suite +0 $

**25 sur 42** alertes B (60 %).

## 5. Variante proposée (rejouée)

- **B** : le signal « taille » exige `taille > max(p90, 2 × médiane)` au lieu de `> p75`.
- **C3** : la taille doublée doit AUSSI dépasser le p90 du trader sur l’actif.

| Trader | Alertes / séance (actuel → variante) | B (actuel → variante) | C3 (actuel → variante) | P&L moyen alertées (variante) | Part perdante alertées (variante) | B gagnantes jusqu’au bout (variante) |
|---|---|---|---|---|---|---|
| Trader A | 0,91 → 0,63 | 33 → 24 | 30 → 18 | +264 $ | 38 % | 16 / 24 |
| Trader B | 0,62 → 0,54 | 9 → 7 | 2 → 1 | −1 $ | 42 % | 3 / 7 |
| Trader C | 0,31 → 0,31 | 0 → 0 | 0 → 0 | −3 $ | 75 % | 0 / 0 |

## Annexe · export en lecture seule

Rôle `mtc_readonly` (aucun droit d'écriture), sorties JSON une ligne par enregistrement :

```sql
-- trades.jsonl : utilisateurs hors démo avec ≥ 10 séances (compte × journée CME)
WITH s AS (
  SELECT t."userId" FROM "Trade" t JOIN "User" u ON u.id = t."userId"
  WHERE NOT u."isDemo" AND t.pnl IS NOT NULL GROUP BY t."userId"
  HAVING count(DISTINCT (t."accountId",
    ((t."tradedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago') + interval '7 hours')::date)) >= 10)
SELECT json_build_object('u', left(md5(t."userId"), 8), 'a', left(md5(coalesce(t."accountId", 'none')), 8),
  'id', left(md5(t.id), 10), 'asset', t.asset, 'side', t.side, 'entry', t.entry, 'quantity', t.quantity,
  'pnl', t.pnl, 'commission', t.commission,
  'tradedAt', to_char(t."tradedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'source', t.source)
FROM "Trade" t WHERE t."userId" IN (SELECT "userId" FROM s) AND t.pnl IS NOT NULL;

-- accounts.jsonl
SELECT json_build_object('a', left(md5(a.id), 8), 'u', left(md5(a."userId"), 8), 'type', a.type,
  'status', a.status, 'accountSize', a."accountSize", 'startingBalance', a."startingBalance",
  'planId', a."propFirmPlanId", 'planSize', p."accountSize", 'phases', p.phases)
FROM "TradingAccount" a LEFT JOIN "PropFirmPlan" p ON p.id = a."propFirmPlanId";

-- users.jsonl
SELECT json_build_object('u', left(md5(id), 8), 'tradesPerDayMax', "tradesPerDayMax", 'style', "tradingStyle")
FROM "User";
```

Puis : `pnpm exec tsx --tsconfig tools/scripts/tsconfig.check.json apps/api-mytradingcoach/scripts/replay-behavior-alerts.ts <dossier>`.
