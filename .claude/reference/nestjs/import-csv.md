# Import de trades (CSV, lots, broker inconnu)

> Contenu déplacé à l'identique depuis `.claude/agents/nestjs.md` le 2026-11-16 (PROMPT-orchestration-agents).
> Chaque bloc garde son titre d'origine ; « Origine » donne l'agent, la section et la date d'origine (date du titre, sinon premier commit qui l'a écrite).

<!-- Origine : nestjs.md · Import de trades en lot (SCA-B1-01/02/04, 2026-10-07) · 2026-10-07 -->
> **Origine** : `nestjs.md` · « Import de trades en lot (SCA-B1-01/02/04, 2026-10-07) » · 2026-10-07

## Import de trades en lot (SCA-B1-01/02/04, 2026-10-07)

`TradesService.importTrades` (CSV, synchro et historique Tradovate) :
- lot vide → retour immédiat, **0 requête** (cas courant de la synchro broker) ;
- trades existants lus sur `[min − 1 j, max + 1 j]` du lot (`importDedupeWindow`, `import-dedupe.util.ts`) :
  la clé exacte porte la date à la ms et le rapprochement entre fuseaux est borné à ±14 h. Une ligne
  sans date valide → tout l'historique ;
- session active, setups, comptes et compte par défaut résolus **une fois par lot**
  (`createImportBatch`, `import-batch.ts`, mémoïsé par promesse : un setup invalide fait échouer
  chacune de ses lignes sans refaire la requête) ;
- cache analytics invalidé **une fois** en fin de lot (et pas si rien n'est créé) ;
- insertion toujours ligne par ligne (`create` + `opts.batch`) : un conflit d'unicité (import
  concurrent) reste compté comme doublon. `createMany` du plan B1-02 non fait (changerait ce comptage).
- `POST /trades/import` : `@Throttle` **5 / min par utilisateur** (`IMPORT_THROTTLE_LIMIT`).

<!-- Origine : nestjs.md · Import CSV : parseurs purs (étape 4 de l'audit, 2026-09-13) · 2026-09-13 -->
> **Origine** : `nestjs.md` · « Import CSV : parseurs purs (étape 4 de l'audit, 2026-09-13) » · 2026-09-13

## Import CSV : parseurs purs (étape 4 de l'audit, 2026-09-13)

> **Excel hors boucle d'événements (SCA-B5-05, 2026-10-07)** : `toCsvText` passe les `.xlsx/.xls` à
> `xlsxToCsv` (`trades/xlsx-worker.ts`) : `worker_thread` à la demande (source en ligne, `eval: true`,
> l'API étant un bundle unique ; `xlsx` résolu par `NODE_PATH`), tas plafonné à 256 Mo, tué après
> 20 s, **un à la fois par process**, `sheetRows = MAX_KNOWN_ROWS + 2` (un fichier trop gros reste
> refusé, avec un compte affiché de 10 001). Fichier piégé → 400 « Impossible de lire ce fichier
> Excel » au lieu de bloquer tout le worker HTTP. Ne jamais rappeler `XLSX.read` dans le thread
> principal. Le CSV texte reste lu sur place (simple `toString`).


- `trades/csv-parsers.ts` : détection du broker, normalisation au CSV pivot (Tradovate, Binance
  futures/spot, Bybit, IBKR, MEXC, MT4/MT5), séparateur européen, `splitCsvLine`,
  `mapNormalizedCsvToDto`, `detectSession`, et les types `BrokerType` / `ImportDto`. Fonctions
  PURES : aucun service injecté, testables directement (`csv-parsers.spec.ts`, `csv-import.service.spec.ts`).
- **MEXC (`parseMexc`, #947)** : « Realized PNL » est NET des frais → stocké en BRUT
  (`roundCents(realized) + roundCents(|fee|)`), frais dans `commission`, pour que `netPnl` ne les retire
  pas deux fois.
- **IBKR (`parseIBKR`, #784)** : relevé Activity Statement, détecté même si la 1ʳᵉ ligne est la
  section `Statement` (on cherche un `Trades,Header` avec `Asset Category`). Un trade = une exécution
  de CLÔTURE (P/L ≠ 0 ou code `C`) : achat = ferme un SHORT, vente = ferme un LONG (sens via
  `Buy/Sell` sinon signe de `Quantity`). `ClosedLot`, `SubTotal`, `Total` sautés sans arrêter la
  lecture ; un `Trades,Header` par catégorie. Entrée = prix × |Basis| / |Proceeds| (multiplicateur
  absorbé). Fixture `__fixtures__/ibkr-activity-statement.csv` **reconstruite** d'après la doc IBKR :
  à remplacer par un relevé réel anonymisé dès qu'on en a un. Heures lues dans le fuseau du serveur.
- **Nombres des parseurs : toujours `parseUsNumber`** (mode `strict` pour les rapports Tradovate, une seule fonction depuis #782), jamais `parseFloat` brut (bug prod du
  2026-10-28). Les exports, et toute conversion Excel (`sheet_to_csv` écrit les nombres formatés),
  mettent `"$1,125.00"` entre guillemets ; `parseFloat` s'arrête à la virgule et rend 1. Un trade
  de +1 125 $ a été importé à +1 $. La virgule n'est retirée que dans un regroupement VALIDE
  (`1,234`, `12,345.67`) : `12,50` européen reste lu 12 (jamais 1 250). Ce garde-fou ne joue qu'en
  appel direct : à l'import, `normalizeSeparator` (`preprocessCsv`) décide le format des nombres
  UNE FOIS pour tout le fichier (#781, `detectNumberFormat`) et réécrit les cellules numériques au
  pivot (`1.234,56` → `1234.56`, `1 234,56 USD` → `1234.56 USD`). `1,085` / `151.234` (milliers ou
  3 décimales) suivent le reste du fichier ; sans indice, virgule seule = décimale si `;`, milliers
  si `,` ; point seul = décimale. US et européen mélangés (fichier retouché dans Excel) →
  `numbersAmbiguous` → import refusé (400, sans IA), jamais deviné. Un CSV `,` au format US repart
  intact. MEXC garde son parseur propre (traité avant). Même règle pour découper une ligne : jamais `split(',')`, un
  champ entre guillemets décale les colonnes (`splitCsvLine`, ou `champsBruts` pour réécrire une
  ligne à l'octet près dans `TradovateHistoryService.horodatagesEnUtc`). Trades déjà touchés :
  `pnl-milliers.util.ts` (détection, `casReparation`) et `scripts/repair-tradovate-pnl-milliers.ts`
  (réparation). Règle du script : ne jamais supprimer une ligne qui ne peut pas revenir de chez
  Tradovate (connexion active, jeton utilisable, synchro < 10 j sans erreur, mois relu à coup sûr) ;
  sinon P&L corrigé sur place et tag `sens-heure-non-verifies`.
- `CsvImportService` garde l'orchestration : plan / accès IA, formats inconnus, fusion des
  frais Tradovate, persistance.
- **Nouveau broker : passer par le REGISTRE, pas par du code** (2026-09-28). Écrire un
  `parseXxx` reste possible mais n'est plus la voie normale : un admin colle un échantillon
  dans `/brokers` (admin), le modèle déduit la fiche, l'admin la corrige et l'enregistre, et
  le broker est reconnu **pour tous les plans** sans build ni déploiement. Les 7 parseurs en
  dur restent en place pour les brokers historiques.
- **Garde-fou Tradovate Performance (2026-10-22)** : `parseTradovate` lit par POSITION (symbol 1,
  qty 7, buyPrice 8, sellPrice 9, pnl 10, boughtTimestamp 11, soldTimestamp 12).
  `tradovateColumnMismatches` compare l'en-tête à `TRADOVATE_POSITIONAL_COLUMNS` ; au moindre
  écart, `preprocessCsv` rend `broker: 'unknown'` + `formatChanged` (rien n'est lu par position).
  Import manuel : fiche du registre si elle existe, sinon 400 « Le format de ce fichier a changé.
  Contacte support@mytradingcoach.app. » : aucune mention de l'import IA, que l'utilisateur ne peut
  pas choisir, et jamais l'IA en douce. Historique par l'API : erreur « rapport Performance au format modifié ».
  Une colonne ajoutée après la 12ᵉ passe.
- **Export vide** (0 octet, 2 octets CRLF / BOM UTF-16 / `""`, en-tête seul) : toujours
  `emptyMessage()` (« Aucun trade fermé détecté… Vérifie aussi la période et le compte… »), plus de
  « Fichier vide » / « Fichier sans données ».
- **Données d'exemple** : identifiants Tradovate des specs et fixtures FICTIFS (`APEX1000…`,
  `9000001x`, `9100001`…). Ne jamais y recoller un vrai nom ou id de compte relevé en prod.

<!-- Origine : nestjs.md · Import d'un broker inconnu : données minimales envoyées à l'IA (2026-10-23) · 2026-10-23 -->
> **Origine** : `nestjs.md` · « Import d'un broker inconnu : données minimales envoyées à l'IA (2026-10-23) » · 2026-10-23

## Import d'un broker inconnu : données minimales envoyées à l'IA (2026-10-23)

`trades/csv-ai-redaction.ts` (pur) prépare TOUT ce qui part vers l'IA d'un fichier de broker
inconnu (mapping `csv_mapping`, repli ligne par ligne `csv_import`, analyse d'échantillon admin) :
- **en-tête gardé tel quel** (le modèle en a besoin pour reconnaître les colonnes) ;
- **valeurs** des colonnes d'identification, reconnues par l'en-tête (compte, client, login, nom
  explicite, e-mail, identifiants d'ordre / de trade / ticket / « Order # ») → jetons stables dans le
  fichier (`compte-1`, `id-3`) : même valeur, même jeton, les lignes restent rapprochables. « Name »
  seul n'est PAS masqué (souvent l'instrument) ;
- autres cellules : e-mails et suites de 7 chiffres ou plus dans un texte masqués ; cellules
  numériques (prix, quantités, horodatages) et dates compactes `AAAAMMJJ…` intactes ; nombre de
  colonnes conservé (index du mapping justes) ;
- **nom du fichier jamais envoyé** (journaux seulement) ;
- masquage fait UNE fois sur tout le fichier dans le repli (jetons stables d'un lot à l'autre).
Plafonds inchangés : mapping = en-tête + `MAPPING_SAMPLE_ROWS` (20) lignes, puis le CODE applique
le mapping à tout le fichier ; repli = toutes les lignes par lots de `AI_BATCH` (25), refus explicite
au-delà de `MAX_AI_ROWS` (2 000), jamais d'import tronqué en silence.
**Limite du repli** : `CSV_AI_FALLBACK_DAILY_LIMIT` (3) passages par utilisateur et par jour (Paris),
compteur Redis `csv-ai-fallback:<userId>:<jour>` (INCR puis contrôle, place rendue si le passage
échoue, Redis indisponible → refus 503) ; au-delà : 429 avec un message clair, aucun appel IA. Le
mapping (1 appel, 20 lignes) n'est pas compté. **Journal** : une ligne JSON par passage
(`event: 'csv_ai_fallback'`, `userId`, `rows`, `batches`, `result` = `ok` · `error` · `too_many_rows` ·
`daily_limit`, `trades`, `durationMs`), jamais le nom ni le contenu du fichier.
