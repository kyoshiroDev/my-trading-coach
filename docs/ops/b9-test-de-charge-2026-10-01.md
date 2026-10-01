# Test de charge B9-01 — 2026-10-01

> Premier test de charge réel (SCA-B9-01), sur **beta**, avec un volume de prod réaliste.
> Procédure et outils : `tools/load/README.md`.
>
> ⚠️ **Correctif du 2026-10-01 (soir)** : le scénario ne reproduisait pas le vrai dashboard. Il
> appelait `/analytics/equity-curve` (un point **par trade**, sur **tout** l'historique) et
> `summary` sur tout l'historique, alors que le dashboard appelle `/equity-curve/daily` et
> `summary` **sur 30 jours** (+ `by-emotion`, `activity/range`). Les chiffres ci-dessous
> **surestiment** donc le coût par utilisateur, et la conclusion Redis (160 Ko/utilisateur) vient
> surtout de cette route que personne n'appelle. Le scénario est corrigé : **le test est à
> relancer** (après #254, qui rend le cache du dashboard enfin efficace).

## Conditions

| | |
|---|---|
| Données | 2 000 comptes **Premium**, 4 120 000 trades (2 000 par compte ; 9 à 10 000 ; 1 à 50 000), sur 2 ans |
| API beta | **format prod** : 3 workers, `DB_POOL_MAX=5` (15 connexions), pool PgBouncer 20, mémoire 2 Go |
| Machine | **le VPS de prod** (4 vCPU, 7,6 Go) : beta, prod, Postgres, Redis, Traefik partagent les 4 cœurs ; API dev arrêtée |
| Scénario (`peak.js`) | chaque utilisateur simulé = un compte : connexion, `/public/stats`, **dashboard complet** (7 appels), 4 tours de polling de session (15 s), journal (2 appels), pause 5-15 s → ~18 requêtes toutes les ~75 s |
| Montée | 200 → 500 → 1 000 → 1 500 utilisateurs simultanés ; **arrêté à 1 500** (prod dégradée à 4,4 s) |
| Injecteur | une machine, clé `LOAD_TEST_KEY` (limites anti-abus actives, comptées par utilisateur) |

Le scénario est **plus lourd que la réalité** : chaque utilisateur rouvre le dashboard complet
toutes les ~75 s, et tous sont Premium (statistiques complètes).

## Résultats (latence mesurée par Traefik, minute par minute)

| Utilisateurs simultanés | Requêtes / min | p50 | p95 | p99 | Charge (4 cœurs) | CPU API beta |
|---|---|---|---|---|---|---|
| 200 | 3 000 | 9 ms | 40 ms | 180 ms | 1,9 | ~95 % |
| 500 | 7 600 | 10 ms | 43 ms | 210 ms | 2,4-4,4 | ~150 % |
| 650 | 11 000 | 18 ms | 89 ms | 230 ms | 4,4 | 220 % |
| **1 000** | **15 000** | **40 ms** | **350-490 ms** | **0,8-1,2 s** | **7-9** | **~250 % (plafond)** |
| 1 150 | 14 000 | **1,5 s** | 3,4 s | 4,3 s | 9,3 | 256 % |
| 1 400-1 500 | 10 700 ↓ | **4 s** | 7,4 s | 9 s | 10,6-11,6 | 258 % |

- **Erreurs de l'API : 0** (aucun 5xx, aucun redémarrage, aucun OOM). Les échecs comptés par k6
  sont des artefacts : 1 253 × 401 (jeton de 15 min non renouvelé par le script, corrigé) et
  439 × 499 (requêtes interrompues à l'arrêt du test).
- **Postgres : aucun goulot.** 0 requête > 500 ms, 1,8 Go de mémoire, ≤ 48 % CPU ; PgBouncer :
  15/15 connexions de l'API actives à partir de 650 utilisateurs, **0 en attente** côté PgBouncer.
- **Prod (même machine)** : 0,14 s → 0,2 s à 1 000 utilisateurs beta, 0,6 s à 1 250, **4,4 s à 1 500**.

## Conclusions

1. **Capacité mesurée : ~1 000 utilisateurs simultanés** (~250 requêtes/s) avec un p95 < 0,5 s.
   Au-delà, effondrement : le débit **baisse** (15 000 → 10 700 req/min) pendant que la latence
   explose. 10 000 inscrits = typiquement 500 à 1 500 simultanés au pic : **on est à la limite**.
2. **Le goulot est le CPU de l'API** (3 workers Node plafonnés à ~2,5 cœurs), pas la base. Cause :
   les statistiques sont calculées **en JavaScript** à partir de **tous** les trades chargés
   (phase **B2**). Mesure isolée : compte à 50 000 trades → `/analytics/equity-curve` = **3,5 Mo
   en 1,3 s**, `summary` et `by-setup` = 0,77 s chacun ; compte à 2 000 trades : < 0,3 s.
3. **Redis : saturé par le cache de la courbe d'equity par trade** (route non utilisée par le
   front, voir l'avertissement en tête), **160 Ko par utilisateur** (2 000 trades). Beta (128 Mo) plein vers 750 utilisateurs. **La prod (256 Mo) le serait vers
   ~1 500 utilisateurs actifs.** Comportement observé à saturation (`noeviction`) : les écritures
   échouent, `markActive` ignore l'erreur, le rate limiting bascule en mémoire (prévu), le cache
   n'est plus écrit → **chaque dashboard recalcule tout → plus de CPU**. En prod, **les files
   BullMQ** (débriefs, webhooks Stripe) seraient aussi bloquées.
4. **Une seule machine pour tout** : la charge de beta dégrade la prod. Le jour J, dev et beta
   doivent être arrêtés (procédure `jour-j.md`), ce qui rend ~1,2 cœur à la prod.

## Actions recommandées, par effet attendu

| # | Action | Effet | Phase |
|---|---|---|---|
| 1 | **Fait (#254)** : cache du dashboard réellement utilisé (clé à la milliseconde → 0 % de cache) ; courbe par trade réduite à 500 points | dashboard recalculé au plus 1 fois/min/utilisateur au lieu de chaque ouverture | B2-01 |
| 2 | Statistiques **en SQL** (`summary`, `by-setup`, `top-assets`, journal) au lieu de charger tous les trades | CPU de l'API par dashboard divisé, temps indépendant du nombre de trades | B2-01 → 04 |
| 3 | Redis prod **512 Mo** (VPS : 3,2 Go disponibles) | repousse la saturation, protège BullMQ | B7-05 |
| 4 | Jour J : `WEB_CONCURRENCY=4` en prod une fois dev/beta arrêtés | +1 worker sur les 4 cœurs | B7-06 |
| 5 | Moins d'appels par onglet (dashboard non rechargé, polling suspendu en arrière-plan) | moins de requêtes par utilisateur | B4 |
| 6 | Second VPS (partie C, payant) | sépare dev/beta de la prod, double la capacité | C |

**Relancer ce test après #1 et #2** (SCA-B9-03) et comparer à ce tableau.

## Nettoyage effectué

Comptes de charge purgés (base beta : 1,5 Go → 31 Mo après `VACUUM FULL`), clés Redis de
charge supprimées, `LOAD_TEST_KEY` retirée de `.env.beta`, `DB_POOL_MAX=2` et pool beta 6
rétablis, API dev relancée. Les trois API saines à la fin.

## Test n°2 (même soir, 22 h 51) — scénario fidèle au dashboard, cache réparé (#254)

Mêmes données, même machine. Scénario = appels exacts de `dashboard.component.ts` (période 30 j,
courbe journalière, `by-emotion`, `activity/range`) + polling de session toutes les 15 s.

| Utilisateurs | p50 | p95 | CPU API beta | Charge | Redis beta |
|---|---|---|---|---|---|
| 250 | — | — | 70-125 % | 2,4 | 8 Mo (test n°1 : 48) |
| 500 | — | — | ~160 % | 3,7 | 10 Mo |
| 760 | — | — | ~240 % | 4,1 | 17 Mo |
| **1 000** | **234 ms** | **1,05 s** | 250-280 % (plafond) | 6,5 | 21 Mo |
| 1 250 | **2,1 s** | 4,2 s | plafond | 8,8 | 28 Mo → **arrêté** |

- **0 contrôle en échec** sur 123 607 (renouvellement du jeton corrigé) ; API : 0 erreur 5xx.
- **Redis réglé** : 28 Mo à 1 250 utilisateurs (test n°1 : saturé à 128 Mo vers 750).
- **Même plafond** qu'au test n°1 : ~**250 requêtes/s** pour la machine (≈ 12 ms de CPU par
  requête, 3 workers). Le scénario émet ~0,24 req/s par utilisateur → 250 / 0,24 ≈ **1 040
  utilisateurs**, ce qu'on mesure.

**Répartition des requêtes au palier 1 000** (Traefik, 3 min) : `session/today/stats` 12 000 et
`market/context` 12 000 (**polling toutes les 15 s = la moitié des requêtes**), puis ~3 000 pour
chaque route du dashboard. `market/context` est déjà en cache et commun à tous : ses 265 ms de
moyenne sont **de l'attente** derrière les workers saturés, pas du calcul.

### Conclusion révisée

Le plafond n'est pas un calcul lourd isolé mais **le débit total de requêtes** :
**capacité ≈ 250 req/s ÷ requêtes par seconde et par utilisateur**. Deux leviers :
1. **Moins de requêtes par utilisateur (B4)** : polling suspendu quand l'onglet est caché
   (B4-02), contexte marché **poussé** par le socket `/eco` au lieu d'être interrogé par chacun
   (B4-03). Le polling seul pèse la moitié du trafic.
2. **Moins de CPU par requête (B3)** : utilisateur authentifié relu en base à **chaque**
   requête (B3-01 : cache Redis 60 s), présence écrite à chaque requête (B3-02).
3. Jour J : 4 workers en prod une fois dev/beta arrêtés (+33 % de débit théorique).

Le scénario reste un **pire cas** : 100 % des utilisateurs en session active avec l'onglet visible.
