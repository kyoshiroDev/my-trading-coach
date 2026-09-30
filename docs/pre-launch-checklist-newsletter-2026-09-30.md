# Checklist avant newsletter NinjaTrader — 30 septembre 2026

> **Passe d'audit uniquement. Rien n'a été corrigé.** Chaque ligne dit ce qui a été *mesuré*
> et ce qui reste *supposé*. Les tests de fumée sont préparés mais **n'ont pas été exécutés
> sur la production**.
>
> Contexte : mise en ligne sur la marketplace NinjaTrader, premiers utilisateurs réels hors
> ambassadeurs. Production déployée depuis la PR #231 (CI et CD en succès le 29/09 à 22 h 40 UTC).

---

## 1. Verdict

Rien ne justifie de repousser la newsletter. Les deux vrais manques ne sont pas des bugs
visibles mais des angles morts : **aucun suivi d'erreurs** et **aucune sauvegarde hors-site**.

| Gravité | Point | Section |
|---|---|---|
| 🔴 | Aucun Sentry : une régression ne sera vue que si un utilisateur écrit | §3 |
| 🔴 | Sauvegardes stockées sur le VPS qu'elles protègent | §3 |
| 🟠 | `mtc_api_prod` à 587 Mo sur 1 Gio, sans plafond de tas V8 | §3 |
| 🟠 | Lien du médiateur de la consommation en NXDOMAIN (pied de page) | §2 |
| 🟡 | Landing très longue : 13,3 écrans en 1440, 22,3 en 375 | §2 |
| 🟡 | Ni HSTS, ni CSP, ni Referrer-Policy | §3 |
| 🟡 | Historique Tradovate incomplet et annoncé complet (phase 2) | §5 |

---

## 2. Parcours d'un visiteur qui arrive par la newsletter

Mesuré sur la production réelle le 30/09, aux deux largeurs demandées.

### Ce qui fonctionne

| Vérification | Résultat |
|---|---|
| `www.mytradingcoach.app` | 200 en 204 ms |
| Apex → www | 301 correct |
| Les 15 liens internes de la landing | **tous en 200**, aucun lien mort |
| Les 4 images référencées | toutes en 200 |
| Lien d'affiliation NinjaTrader | 200 après 6 redirections |
| `og:image`, `robots.txt`, `sitemap-index.xml`, `/blog` | tous en 200 |
| JSON-LD | 1 bloc présent |
| Erreurs console | aucune |
| Débordement horizontal | aucun, aux deux largeurs |
| Visuel produit du hero | chargé et rendu (1919×959 réels) |
| Animations `reveal` | se déclenchent correctement |
| Repli mouvement réduit | correct : `.reveal { opacity: 1; transition: none }` |

### Mesures de mise en page

| | Bureau 1440 | Mobile 375 |
|---|---|---|
| Hauteur de page | 12 002 px — **13,3 écrans** | 18 109 px — **22,3 écrans** |
| Taille du `h1` | 51,8 px | 36 px |
| CTA principal du hero | visible sans défiler (y = 560) | barre collante en bas de vue |
| Bouton démo | à côté du CTA, y = 560 | y = 694 |
| Visuel du hero | 579 × 290, colonne de droite | — |

### Observations d'ergonomie

1. **La page est longue.** 22,3 écrans sur mobile pour un lecteur venu d'une newsletter, qui
   décide en quelques secondes. Le hero fait son travail — proposition, deux CTA et ligne de
   réassurance tiennent dans le premier écran aux deux largeurs — mais la suite demande un
   engagement important.
2. **La preuve produit est petite.** Le visuel du hero fait 579 × 290 pour une source de
   1919 × 959 : lisible au zoom, illisible en taille réelle. C'est la seule image d'application
   au-dessus de la ligne de flottaison, et le seul argument visuel qu'un inconnu reçoit.
3. **Le CTA collant du mobile double celui du hero**, à 66 px l'un de l'autre au chargement.
4. **Aucune balise `<noscript>`.** Avec JavaScript désactivé, les 28 blocs `reveal` restent à
   `opacity: 0` et la page est vide sous le hero. Impact faible en volume, total en gravité
   pour ceux que ça touche.
5. 🟠 **Le lien « médiateur de la consommation » du pied de page est mort.**
   `www.mediateur-du-numerique.fr` renvoie **NXDOMAIN** (vérifié sur le résolveur local et sur
   1.1.1.1 ; la variante sans `www` échoue aussi). C'est une mention légale obligatoire pour
   un service payant destiné à des consommateurs français.

### Non mesuré

Le rendu de l'**application** en 375 px n'a pas pu être mesuré : l'outil de redimensionnement
de fenêtre reste sans effet et `app.mytradingcoach.app` refuse d'être encadré
(`x-frame-options: SAMEORIGIN`). La page `/register` a été vérifiée, elle s'affiche correctement.
Le parcours mobile de l'app doit être fait **sur un vrai téléphone** (ligne 18 des tests de fumée).

---

## 3. Capacité de l'infrastructure

### Machine — très au large

| Mesure | Valeur |
|---|---|
| vCPU | 4 |
| RAM | 7,7 Go, dont 2,7 utilisés |
| Charge 1/5/15 min | 0,05 / 0,08 / 0,09 |
| Disque | 41 Go libres sur 72 |
| Swap | 2 Go, 181 Mo utilisés |

### Le seul point tendu — l'API de production

`mtc_api_prod` occupe **587 Mo sur un plafond de 1 Gio**, soit 55 %, **sans trafic**.

C'est cinq processus Node : `main.ts:102` lit `availableParallelism()` = 4 et démarre
1 primaire (135 Mo) plus 4 workers (172 à 188 Mo chacun). La somme des RSS fait 856 Mo, mais
le cgroup n'en compte que 591 : les workers partagent avec le primaire le code et les modules
chargés avant le `fork`. Coût marginal réel d'un worker : environ 114 Mo.

C'est du tas (`anon` = 591 Mo), pas du cache (`file` = 2,9 Mo) : rien ne sera rendu sous pression.

**Ce n'est pas une fuite** — comparaison décisive :

| | Démarré depuis | Mémoire |
|---|---|---|
| `mtc_api_prod` | 2 j 13 h | 587 Mo |
| `mtc_api_beta` | 40 min | 610 Mo |

Beta, tout frais, consomme davantage. C'est l'empreinte de démarrage.

🟠 **Le risque est ailleurs : aucun `--max-old-space-size` n'est défini** (`NODE_OPTIONS` absent).
Chaque worker croit disposer de ~2 Go de tas, très au-delà du plafond du conteneur. Si un worker
gonfle — import CSV de 2 000 lignes, réponses IA simultanées — **c'est le conteneur que l'OOM
killer arrête**, avant que V8 ne collecte. Le cluster relance ensuite (garde-fou : 5 redémarrages
par minute maximum).

Leviers possibles, non appliqués : plafonner le tas par worker, réduire à 2 workers pour la
fenêtre de lancement, ou arrêter `mtc_api_beta` ce jour-là (610 Mo rendus d'un coup).

### Base de données

| Mesure | Valeur |
|---|---|
| `max_connections` | 50 |
| Connexions actives | 8 |
| pgbouncer | mode `transaction`, pool 25, `MAX_CLIENT_CONN` 200 |
| Tailles prod / beta / dev | 38 / 30 / 12 Mo |

À vérifier un jour : trois bases derrière le même pgbouncer, pool de 25 chacune, soit
75 connexions serveur possibles pour un `max_connections` de 50. Sans effet au trafic actuel.

### Sécurité et exploitation

| Point | État |
|---|---|
| Certificat TLS | valide jusqu'au **14 décembre 2026** |
| `/api/health` | 200 en 140 ms |
| `AI_ENABLED` | **`true`** — le piège connu est refermé |
| Variables Tradovate / Stripe / Resend / Redis | toutes présentes |
| Rate limiting | 60 req/min par client, stockage Redis partagé entre workers |
| `x-frame-options` / `x-content-type-options` | présents |
| Rotation des logs Docker | 3 × 50 Mo |
| **HSTS, CSP, Referrer-Policy, Permissions-Policy** | 🟡 **toutes absentes** |
| **Sentry / suivi d'erreurs** | 🔴 **absent** |

### Sauvegardes

| Quoi | État |
|---|---|
| Base, quotidienne à 3 h | ✅ dernière le 29/09, prod 4,6 Mo, log sans erreur |
| Images API, hebdomadaire | ✅ dernière le 27/09, 652 Mo |
| **Copie hors-site** | 🔴 **aucune** — tout est dans `/opt/backups` du VPS sauvegardé |

---

## 4. Tests de fumée — à préparer, **pas à exécuter sur la prod dans cette passe**

Ordre = parcours d'un inconnu. S'arrêter au premier échec bloquant.

### Bloquants — si l'un échoue, la newsletter attend

| # | Chemin | Geste | Attendu |
|---|---|---|---|
| 1 | Landing | ouvrir `www.mytradingcoach.app` | 200, hero complet, pas de défilement horizontal |
| 2 | Landing | apex `mytradingcoach.app` | 301 vers `www` |
| 3 | API | `GET /api/health` | `{"data":{"status":"ok"}}` |
| 4 | Inscription | créer un compte avec une adresse neuve | arrivée au tableau de bord, pas de 500 |
| 5 | E-mail | message de bienvenue | reçu en boîte principale, pas en spam |
| 6 | Connexion | se déconnecter, se reconnecter | session rétablie |
| 7 | Démo | bouton « Tester la démo » | lecture seule, données visibles |
| 8 | Démo | tenter une modification | 403 « Action non disponible en mode démo » |
| 9 | Trade | créer un trade à la main | apparaît au journal, P&L calculé |
| 10 | Import CSV | importer un export Tradovate connu | trades créés, P&L conforme au fichier |
| 11 | Mot de passe | « mot de passe oublié » | e-mail reçu, lien valide |

### Importants — dégradent sans bloquer

| # | Chemin | Geste | Attendu |
|---|---|---|---|
| 12 | Tradovate | connexion OAuth | redirection propre, compte listé |
| 13 | Tradovate | bouton « Synchroniser » | trades remontés, compteur à jour |
| 14 | IA | lancer un débrief | réponse générée, pas « IA temporairement indisponible » |
| 15 | Facturation | ouvrir le tunnel Stripe **sans payer** | page affichée, prix 49 € |
| 16 | Calendrier éco | ouvrir la vue | événements du jour affichés |
| 17 | Analytics | ouvrir avec des trades | graphiques rendus, pas de division par zéro |
| 18 | Mobile | refaire 1 → 9 **sur un vrai téléphone** | rien de coupé, boutons atteignables au pouce |

### Après la mise en ligne — à surveiller

| # | Quoi | Où |
|---|---|---|
| 19 | Erreurs 500 | `docker logs mtc_api_prod` — **seul moyen, faute de Sentry** |
| 20 | Mémoire de l'API | `docker stats mtc_api_prod` — plafond 1 Gio |
| 21 | Inscriptions réelles | table `User`, en excluant `isDemo` |
| 22 | Connexions broker cassées | `BrokerConnection.status = NEEDS_RECONNECT` |

---

## 5. Angles morts connus, hérités des phases 1 et 2

Ces points sont **mesurés** et **non corrigés**. Ils ne bloquent pas la mise en ligne mais
personne ne les verra si on ne les surveille pas.

1. **L'historique importé peut être incomplet tout en s'annonçant complet.** Sur le compte de
   Val, 11 jours de trading de juillet manquent : le rapport `Fills` de Tradovate les prouve
   (110 fills sur 13 jours) mais son rapport `Performance` ne les apparie pas (10 lignes sur
   2 jours). L'import a posé `historyImportedAt` avec « 0 échec », donc le cron ne réessaiera
   jamais. Écart chiffré : 84,76 $ de frais non attribués, ≈ 81 aller-retours.
   Le compteur `feesAssigned` / `feesExpected` avait détecté l'anomalie mais ne sort qu'en log.
2. **Le type de compte (`FUNDED` / `EVALUATION`) est purement déclaratif.** Aucun champ
   Tradovate ne permet de le vérifier : les 9 comptes de Val, évaluations et financés confondus,
   renvoient tous `accountType: Customer`, `legalStatus: Individual`,
   `marginAccountType: Speculator`, et tous vivent sur l'environnement `demo`.
3. **Aucun test de charge n'a été fait.** La marge mémoire est de 457 Mo et n'a jamais été
   éprouvée sous trafic réel.
