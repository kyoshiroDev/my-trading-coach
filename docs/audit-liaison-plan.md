# Audit · liaison compte ↔ plan prop firm (#612, étape 0 · #613)

> Relevé du 2026-10-18 sur `origin/beta` (4821f36d) et la base prod (lecture seule, rôle `mtc_readonly`).
> Objet : comprendre pourquoi presque aucun compte n'est relié à son plan du catalogue avant de
> construire l'écran « Quel est ce compte ? ».

## En bref

- **Le catalogue n'est pas le problème.** 16 firms, 264 plans actifs, 490 phases : aucune phase sans
  drawdown, type de drawdown, objectif (évaluation) ni max contrats. Apex et Lucid sont complets.
  Ce qui manque, c'est la **liaison** : **0 compte connecté sur 6 relié à un plan** chez les vrais
  utilisateurs (hors démo et ADMIN), 0 compte prop firm sur 7.
- **Aucun parcours ne propose le plan au bon moment.** L'onboarding crée le compte avec une firm en
  texte libre, la connexion Tradovate ne parle jamais du plan, et le sélecteur n'existe que dans le
  formulaire « Modifier le compte ».
- **Le bandeau de rattrapage de Mes comptes est presque toujours masqué** : il exige que les règles
  saisies collent exactement à un plan (devise, objectif, drawdown). Sur les 7 comptes prop firm
  réels, au plus 3 l'affichent.
- **Le plan peut se deviner en partie sans nouvel appel** : la firm et la phase depuis le nom du
  sous-compte (`APEX…` éval, `PAAPEX…` PA Apex, `TAKEPROFIT…`), et la taille depuis le premier solde
  de clôture déjà importé. Le **programme**, lui (EOD / intraday / legacy, avec ou sans DLL), ne se
  devine pas : il faut le demander.
- **Correction du rapport de rejeu** (`docs/rapport-detecteurs-silencieux.md:17`) : le seul compte
  relié (`apex-eod-50k`) **a** une perte max du jour au catalogue, 1 000 $ en évaluation comme en PA
  (vérifié en base prod, `PropFirmPlan.phases`). Le « pas de perte max du jour » du rejeu vient
  d'ailleurs, à expliquer avant de s'appuyer dessus (piste : l'export `accounts.jsonl` du rejeu).

---

## 1. Comment un compte est relié à un plan aujourd'hui

### Modèle

| Élément | Référence |
|---|---|
| `TradingAccount.propFirmPlanId` (optionnel, `onDelete: SetNull`) | `prisma/schema.prisma:350-351` |
| Règles saisies à la main, qui restent la référence sans plan (`accountSize`, `profitTarget`, `maxDrawdown`, `drawdownType`) | `prisma/schema.prisma:334-340` |
| `PropFirm` / `PropFirmPlan`, miroir du JSON `libs/shared/src/prop-firm-rules/*.json`, synchronisé au démarrage de l'API | `prisma/schema.prisma:969-1022` |
| Pas de champ « plan à renseigner », « compte perso confirmé » ni « firm absente du catalogue » : un compte sans plan ne dit pas **pourquoi** il n'en a pas | — |

### Écrans qui posent le plan

| Où | Comment | Référence |
|---|---|---|
| Mes comptes · formulaire Créer / Modifier | `mtc-prop-firm-plan-picker` (firm → programme → taille), affiché seulement si le type est Évaluation / Funded et le catalogue chargé. Optionnel, sous le choix du type. | `accounts.component.html:530-543`, `prop-firm-plan-picker.component.ts:18-24`, `accounts.component.ts:724-741` (`onPlanChoice`) |
| Mes comptes · bandeau « Relie ce compte à son plan {firm} » | Ouvre le formulaire Modifier. Masquable (croix), le masquage vit en `localStorage` (`mtc.accounts.planLinkDismissed`). | `accounts.component.html:282-295`, `accounts.component.ts:119`, `:207-218`, `:663-670` |
| Backfill API | Relie d'office les comptes saisis **avant le 2026-10-02** quand **un seul** plan colle. Ne touche jamais un compte récent. | `prop-firm-plan-backfill.service.ts:12`, `:28-56` |
| Onboarding (étape 3) | **Aucun** sélecteur : firm en texte libre, objectif et drawdown à la main. Le compte est créé sans plan. | `onboarding.component.html:156-175`, `onboarding.model.ts:91-113` |
| Connexion Tradovate | **Aucune** question sur le plan, ni dans l'onboarding ni dans Mes comptes. | cf. §2 |
| Session live | Lien « Relie-le à son plan » vers `/accounts`, seulement quand il n'y a **aucune** règle de drawdown (même saisie à la main). | `live-prop-firm.component.html:96-101` |

### Pourquoi si peu le font

1. **Le chemin principal ne passe jamais par le sélecteur.** Un nouvel inscrit fait l'onboarding
   (firm en texte libre) puis connecte Tradovate : à aucun moment on ne lui montre le catalogue.
   Le sélecteur n'est visible que si l'utilisateur pense de lui-même à rouvrir « Modifier le compte ».
2. **Le bandeau de rattrapage exige une correspondance exacte** (`plan-match.ts:54-75`) : même
   devise que le plan, objectif et drawdown identiques s'ils sont saisis, sinon pas de bandeau. En prod :
   - `Lucid ##` en **EUR** (catalogue en USD) → pas de bandeau ;
   - `Apex ##` avec objectif **2 000** (Apex 50k = 3 000) → pas de bandeau ;
   - `Tradeify` avec objectif **30 000** (faute de frappe) et sans `broker` → pas de bandeau ;
   - `DEMO`, broker vide → la firm n'est pas reconnue → pas de bandeau.
   Restent au mieux 3 comptes (`Apex ##` 3 000/2 000 et les deux `PA APEX …`), si la croix n'a pas été cliquée.
   Plus la saisie à la main est fausse, moins on propose le plan, alors que c'est justement le cas où il aiderait le plus.
3. **Le bandeau ne s'appuie jamais sur Tradovate** : il lit `broker` et `label`, pas le nom du
   sous-compte (`APEX…`, `PAAPEX…`) ni le solde de départ importé.
4. **Le backfill est figé** sur les comptes antérieurs au 2026-10-02 et sur un match unique, qui
   n'arrive presque jamais (Apex 50k : 3 programmes, Lucid 50k : 10).
5. **La Session live masque le manque** : avec un drawdown saisi à la main, la jauge s'affiche
   (`source: 'manual'`) et rien n'invite à relier le plan. La perte max du jour, elle, n'apparaît
   qu'avec un plan **et** en Premium (`accounts.service.ts:479-481`).

---

## 2. Parcours de connexion Tradovate, écran par écran

### Depuis l'onboarding (cas majoritaire)

1. **Étape 3 · Ton compte** : Perso / Prop firm, taille, firm en texte libre, objectif, drawdown
   (`onboarding.component.html:89-175`). Le compte MTC est créé au checkpoint Stratégie
   (`onboarding.component.ts:573-595`) : label `«{firm}» #1`, type `EVALUATION` d'office pour une prop
   firm (`onboarding.model.ts:97-98`), même pour un PA.
2. **Étape 8 · Tes trades** : carte « Connecter mon compte Tradovate » → `chooseTradovate()` récupère
   ou crée le compte cible (`onboarding.component.ts:413-447`).
3. **Modale de réassurance** `mtc-tradovate-connect-modal` (`onboarding.component.html:519-521`), puis
   redirection OAuth vers Tradovate.
4. **Callback API** `completeAuthorization` (`tradovate-connection.service.ts:103-141`) : échange du
   code, lecture des sous-comptes (`discoverAccounts`), filtrage des comptes déjà reliés ailleurs,
   enregistrement de `availableAccounts` (`:270-300`). Retour toujours en `select_account` à la
   première connexion : rien n'est importé sans confirmation.
5. **Retour sur l'étape 8** (`readTradovateReturn`, `onboarding.component.ts:287-313`) → bloc
   « Compte Tradovate connecté » avec **`TradovateAccountPickerComponent`**
   (`onboarding.component.html:396-410`, `tradovate-account-picker.component.ts:10-47`) : nom du
   sous-compte + « Compte simulé · prop firm ou démo » / « Compte réel ».
6. « Synchroniser ce compte » → `selectThenSync` (`onboarding.component.ts:457-471`) : l'API pose
   le sous-compte et aligne la devise (`tradovate-connection.service.ts:332-362`), puis la synchro
   importe l'historique.
7. **Étape 9 · Récap** (trades importés, frais). **Fin du parcours, sans question sur le plan.**

### Depuis Mes comptes

1. Créer le compte (formulaire avec le sélecteur de plan, optionnel), ou partir d'un compte existant.
2. Bouton « Connecter Tradovate » sur la ligne (`accounts.component.html:209-216`, `accounts.component.ts:432-434`).
3. Modale de réassurance → OAuth → callback (identique).
4. Sous-ligne du compte avec `TradovateAccountPickerComponent` tant que `needsAccountSelection`
   (`accounts.component.html:305-315`, `tradovate-connection.view.ts:69`).
5. `pickTradovateAccount` → `selectThenSync` (`accounts.component.ts:440-442`). Fin.

**Point d'insertion naturel de l'écran « Quel est ce compte ? »** : juste après le retour de
`selectThenSync` (onboarding avant l'étape 9, Mes comptes à la place du picker). À ce moment la
synchro a importé l'historique, donc le solde de départ est connu (cf. §4).

---

## 3. État du catalogue

Lecture de `libs/shared/src/prop-firm-rules/*.json` (identique à la base prod : 264 plans actifs, 5
retirés). « Phases » = évaluation + funded (+ direct). Colonnes « manquant » : règle attendue mais vide.

| Firm | Relevé | Plans (à revoir) | Tailles | Phases | DLL renseignée | Sans DLL (règle absente) | DLL inconnue | Drawdown manquant | Type DD manquant | Contrôle en séance inconnu | Objectif éval manquant | Max contrats manquant | Phases avec consistency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Apex Trader Funding (`apex`) | 2026-10-07 | 14 (0) | 25/50/100/150/250/300k | éval, funded | 12 | 16 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| BluSky Trading (`blusky`) | 2026-10-07 | 15 (0) | 3/25/50/100/150/200/300k | direct, éval, funded | 2 | 26 | 0 | 0 | 0 | 0 | 0 | 0 | 15 |
| Bulenox (`bulenox`) | 2026-10-09 | 24 (0) | 25/50/100/150k | direct, éval, funded | 19 | 21 | 0 | 0 | 0 | 0 | 0 | 0 | 24 |
| Earn2Trade (`earn2trade`) | 2026-10-05 | 7 (0) | 25/50/100/150/200k | éval, funded | 14 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 7 |
| Elite Trader Funding (`elitetraderfunding`) | 2026-10-05 | 14 (0) | 10/25/50/100/150k | direct, éval, funded | 6 | 19 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Funded Futures Family (`fundedfuturesfamily`) | 2026-10-03 | 25 (0) | 25/50/100/150k | direct, éval, funded | 0 | 45 | 0 | 0 | 0 | 0 | 0 | 0 | 29 |
| Lucid Trading (`lucid`) | 2026-10-02 | 40 (0) | 25/50/100/150k | direct, éval, funded | 35 | 37 | 0 | 0 | 0 | 0 | 0 | 0 | 40 |
| MyFundedFutures (`myfundedfutures`) | 2026-10-06 | 14 (0) | 25/50/100/150k | éval, funded | 10 | 18 | 0 | 0 | 0 | 0 | 0 | 0 | 14 |
| OneUp Trader (`oneuptrader`) | 2026-10-07 | 15 (5) | 25/50/100/150/250k | éval, funded | 0 | 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Phidias Propfirm (`phidias`) | 2026-10-06 | 10 (0) | 25/50/100/150k | éval, funded | 0 | 20 | 0 | 0 | 0 | 0 | 0 | 0 | 6 |
| Take Profit Trader (`takeprofittrader`) | 2026-10-03 | 5 (0) | 25/50/75/100/150k | éval, funded | 0 | 10 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| Top One Futures (`toponefutures`) | 2026-10-03 | 23 (0) | 25/50/100/150k | direct, éval, funded | 30 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 23 |
| Topstep (`topstep`) | 2026-10-05 | 12 (0) | 50/100/150k | éval, funded | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 18 |
| TradeDay (`tradeday`) | 2026-10-03 | 12 (0) | 25/50/100/150k | éval, funded | 0 | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 16 |
| Tradeify (`tradeify`) | 2026-10-07 | 28 (0) | 25/50/100/150/300k | direct, éval, funded | 24 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | 28 |
| UProfit (`uprofit`) | 2026-10-04 | 6 (0) | 50/100/150k | éval, funded | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 12 |
| **Total** | | **264 (5)** | | **490** | **170** | **320** | **0** | **0** | **0** | **0** | **0** | **0** | **251** |

Précisions :

- **« Sans DLL » ≠ donnée manquante, mais seulement dans le JSON.** La convention du catalogue
  (`README.md`, § Conventions) : `daily_loss_limit: null` = la règle n'existe pas ; règle existante non
  publiée = `null` + `needs_review: true` + explication dans `notes`. Les 5 plans à revoir (OneUp
  Trader) le sont pour d'autres règles, pas pour la DLL.
- **La distinction se perd dans l'API.** Le résumé `GET /prop-firms` aplatit
  `dailyLossLimit: p.daily_loss_limit?.amount ?? null` (`prop-firm-catalog.service.ts:62`), et le
  contrat le documente lui-même : « null si la règle n'existe pas **ou** n'est pas publiée »
  (`libs/shared/src/contracts/prop-firm.ts:18-19`). Côté app, impossible de distinguer « pas de perte
  max du jour » et « on ne sait pas ». C'est **là** qu'il faut un `hasDailyLossLimit`, pas dans le JSON
  (cf. question 1 en fin de doc).
- **DLL par paliers** (PA Apex) : le résumé ne garde que `amount` (palier 1). Le calcul en séance, lui,
  lit la règle complète (`behavior-plan.ts:36-38`, `accounts/daily-loss`) : pas de perte.
- **Apex** : les 4 Intraday et les 6 Legacy (évaluation + PA) n'ont pas de DLL. C'est la règle
  officielle, pas une donnée manquante. Les EOD en ont une (éval 500 / 1 000 / 1 500 / 2 000 $), les PA
  Intraday et EOD ont des paliers. Max contrats renseignés partout, paliers en PA.
- **Lucid** : DLL seulement sur les variantes `-dll` (option payante au checkout) et sur LucidDirect
  ≥ 50k. Max contrats renseignés partout. Relevé du **2026-10-02**, le plus ancien du catalogue (veille
  > 15 j).
- **Étape 1 en conséquence** : pour Apex et Lucid il n'y a **rien à inventer ni à combler**. Le
  travail utile se réduit à une revérification Lucid (relevé le plus ancien) et à exposer
  explicitement « pas de DLL » vs « DLL inconnue » dans le contrat.

---

## 4. Peut-on deviner le plan depuis Tradovate ?

Données **déjà stockées**, sans nouvel appel : `BrokerConnection.availableAccounts` (`{id, name, env,
userId}`, `tradovate.types.ts:153-166`), `externalAccountName`, `externalEnv`, et après la première
synchro `BrokerDailyClose` (solde de clôture officiel par séance). Relevé prod (noms masqués, chiffres
remplacés par `#`) :

| Forme du nom | Connexions | `env` | Propriétaire (`userId`) | Ce qu'on en déduit | Fiabilité |
|---|---|---|---|---|---|
| `APEX#############` | 12 | demo | 699523 | Apex · **évaluation** | Forte (préfixe officiel Apex) |
| `PAAPEX############` | 5 | demo | 699523 | Apex · **PA (funded)** | Forte. Un compte réel est typé `EVALUATION` dans MTC alors que c'est un PA : l'indice corrigerait la phase. |
| `TAKEPROFIT#########` | 1 | demo | — | Take Profit Trader | Forte (nom de la firm) |
| `TDFY-DEMO-##`, `APEX-DEMO-##` | 2 | demo | — | Comptes du seed démo | Hors sujet |
| `DEMO#######` | 2 | demo | = login du trader | Compte **démo Tradovate perso**, pas une prop firm | Forte : le propriétaire est le trader lui-même |
| `#######` (numérique) | 1 | **live** | = login | Compte **réel** → « Compte perso » | Forte |
| `PTLOP##########` | 3 | demo | 2372622 | **Firm non identifiée** | Aucune : à confirmer auprès du trader, ne pas deviner |

Autres indices :

- **Propriétaire du compte** (`ExternalAccountRef.userId`) : identifiant de la **firm** sur un compte
  prop (tous les comptes Apex portent `699523`, cf. commentaire `tradovate.types.ts:157-162`). Utile pour
  confirmer une firm déjà reconnue par le nom, mais la table firm ↔ id n'existe que pour Apex : on ne
  s'en sert pas seul.
- **`env`** : `live` = compte réel (jamais prop firm) ; `demo` = prop firm **ou** démo perso.
- **Taille du compte** : absente du nom. En revanche, le **premier** `BrokerDailyClose` donne le solde
  de départ (`closingBalance − realizedPnl`) : **50 000** ou **300 000** sur les 8 comptes synchronisés
  en prod, toujours une taille du catalogue. Disponible seulement **après** l'import d'historique,
  d'où l'écran à placer après `selectThenSync`. Un compte reconnecté en cours de route (historique
  partiel) donnerait un solde ≠ taille : ne pré-sélectionner que si la valeur tombe exactement sur une
  taille de la firm.
- **Programme** (EOD / intraday / legacy, DLL ON/OFF, chemin de payout) : **aucun indice**. Apex 50k a
  3 programmes, Lucid 50k en a 10. La pré-sélection porte donc sur **firm + taille + phase**, et
  l'utilisateur choisit toujours le programme.
- Préfixe `LFE…` cité dans le prompt : **absent** des données prod, rien à en tirer aujourd'hui.

### Règle de détection proposée (étape 2)

| Cas | Condition | Écran |
|---|---|---|
| **Trouvé** | préfixe connu (`APEX`, `PAAPEX`, `TAKEPROFIT`…) **et** solde de départ = une taille de la firm | « On dirait un Apex 50k (PA), c'est bien ça ? » Oui → choix du programme / Changer |
| **Ambigu** | préfixe connu mais taille inconnue ou hors catalogue | firm pré-choisie, taille à choisir |
| **Perso** | `env = live`, ou `DEMO#…` dont le propriétaire est le login | « Compte perso ? » pré-coché |
| **Absent** | préfixe inconnu (`PTLOP…`) | parcours complet firm → taille → phase → programme |

La table des préfixes vit dans `@mtc/shared` (pure, testable), pas dans le JSON du catalogue.

---

## Taux de liaison actuel (prod, 2026-10-18, lecture seule)

Filtre `REAL_USERS` (`isDemo = false`, `role ≠ ADMIN`, `users.service.ts:253`), comptes non archivés :

| Mesure | Valeur |
|---|---|
| Comptes | 11 |
| dont connectés à Tradovate | 6 (5 avec sous-compte choisi) |
| **dont reliés à un plan** | **0 / 6** |
| Comptes prop firm (Évaluation / Funded) | 7 |
| dont reliés à un plan | 0 / 7 |
| Toutes populations confondues | 3 comptes reliés : 1 ADMIN (`apex-eod-50k`) et 2 comptes du seed démo |

---

## Questions avant l'étape 1

1. **`hasDailyLossLimit`** : la convention du JSON distingue déjà « pas de règle » (`null`) et « règle
   inconnue » (`null` + `needs_review`). Je propose de **ne pas** dupliquer l'info dans les 16 JSON,
   mais d'exposer dans le contrat `PropFirmPhaseSummary` un `dailyLossLimitStatus: 'none' | 'known' |
   'unknown'` (ou `hasDailyLossLimit: boolean | null`) calculé par l'API. Le test « plan sans perte
   journalière ≠ perte journalière inconnue » portera sur ce champ. OK ?
2. **Étape 1 réduite** : Apex et Lucid sont complets. Je fais une revérification Lucid (relevé du 2
   octobre) sur les pages officielles, avec date et URL, et je ne touche à Apex que si la veille signale
   un changement. OK ?
3. **Enregistrement des nouveaux états** (étape 2) : il faut stocker « plan à renseigner »,
   « compte perso confirmé » et le texte « Ma firm n'est pas dans la liste ». Proposition : sur
   `TradingAccount`, un `planStatus` (`TO_FILL` | `LINKED` | `PERSONAL` | `UNLISTED`) + `unlistedFirmName
   String?`, migration additive. Le masquage du bandeau sort du `localStorage`.
